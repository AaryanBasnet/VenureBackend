const chatService = require("../services/chatService");
const logger = require("../utils/logger");

function setupSocket(server) {
  const io = require("socket.io")(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.info({ message: "New socket connection", socketId: socket.id });

    socket.on("join", (userId) => {
      if (!userId) return;
      socket.join(userId);
      logger.info({ message: "Socket joined room", socketId: socket.id, userId });
    });

    socket.on("sendMessage", async (payload) => {
      const { chatId, sender, receiver, text } = payload;

      if (!chatId || !sender || !receiver || !text) {
        return socket.emit("sendMessageError", { error: "Invalid message payload" });
      }

      try {
        const { messagePayload, notificationPayload } = await chatService.saveMessage(
          chatId,
          sender,
          receiver,
          text
        );

        io.to(receiver).emit("receiveMessage", messagePayload);
        io.to(receiver).emit("newNotification", notificationPayload);

      } catch (error) {
        logger.error({ message: "Error handling sendMessage", chatId, error: error.message });
        socket.emit("sendMessageError", {
          chatId,
          error: error.message || "Failed to send message.",
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
