const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const chatService = require("../services/chatService");
const { verifySocketToken } = require("../services/authService");
const User = require("../model/user");
const logger = require("../utils/logger");

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Resolves the user id for a handshake. Accepts either the short-lived socket token
 * (handshake auth, works cross-site) or the HTTP-only access-token cookie.
 */
const authenticateHandshake = async (handshake) => {
  let userId;

  if (handshake.auth?.token) {
    userId = verifySocketToken(handshake.auth.token).id;
  } else {
    const cookies = cookie.parse(handshake.headers.cookie || "");
    if (!cookies.accessToken) throw new Error("Authentication required");
    userId = jwt.verify(cookies.accessToken, process.env.JWT_SECRET).id;
  }

  const user = await User.findOne({ _id: userId, isDeleted: { $ne: true } }).select("_id");
  if (!user) throw new Error("Authentication required");
  return user._id.toString();
};

function setupSocket(server, isAllowedOrigin) {
  const io = require("socket.io")(server, {
    cors: {
      origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Every connection must be authenticated; identity comes only from the server
  io.use(async (socket, next) => {
    try {
      socket.userId = await authenticateHandshake(socket.handshake);
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    // Users only ever join their own room
    socket.join(socket.userId);
    logger.info({ message: "Socket connected", socketId: socket.id, userId: socket.userId });

    // Kept for older clients; the room is already joined from the verified identity
    socket.on("join", () => {});

    socket.on("sendMessage", async (payload = {}) => {
      const { chatId } = payload;
      const text = typeof payload.text === "string" ? payload.text.trim() : "";

      if (!chatId || !text || text.length > MAX_MESSAGE_LENGTH) {
        return socket.emit("sendMessageError", { chatId, error: "Invalid message payload" });
      }

      try {
        // Sender is the authenticated user; the receiver is derived from the chat itself
        const { messagePayload, notificationPayload, receiverId } = await chatService.saveMessage(
          chatId,
          socket.userId,
          text
        );

        io.to(receiverId).emit("receiveMessage", messagePayload);
        io.to(receiverId).emit("newNotification", notificationPayload);
        // Echo to the sender's other tabs/devices
        socket.to(socket.userId).emit("receiveMessage", messagePayload);
      } catch (error) {
        logger.error({ message: "Error handling sendMessage", chatId, error: error.message });
        socket.emit("sendMessageError", {
          chatId,
          error: error.isOperational ? error.message : "Failed to send message.",
        });
      }
    });

    socket.on("disconnect", () => {
      logger.info({ message: "Socket disconnected", socketId: socket.id });
    });
  });

  return io;
}

module.exports = setupSocket;
