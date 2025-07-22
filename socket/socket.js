const Message = require("../model/message");
const Chat = require("../model/chat");
const Notification = require("../model/notification");

function setupSocket(server) {
  const io = require("socket.io")(server, {
    cors: {
      origin: "*", // Replace with your frontend origin in production
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("New socket connection:", socket.id);

    socket.on("join", (userId) => {
      if (!userId) {
        console.warn(`Socket ${socket.id} tried to join with empty userId`);
        return;
      }
      socket.join(userId);
      console.log(`Socket ${socket.id} joined room: ${userId}`);
    });

    socket.on("sendMessage", async ({ chatId, sender, receiver, text }) => {
      if (!chatId || !sender || !receiver || !text) {
        console.warn(
          `Invalid sendMessage payload from socket ${socket.id}:`,
          { chatId, sender, receiver, text }
        );
        return;
      }

      console.log(`sendMessage from ${sender} to ${receiver}: ${text}`);

      try {
        const message = new Message({ chatId, sender, receiver, text });
        await message.save();

        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: { text, timestamp: new Date() },
        });

        // Prepare full message payload for client
        const messagePayload = {
          _id: message._id.toString(),
          chatId,
          sender,
          receiver,
          text,
          timestamp: message.createdAt
            ? message.createdAt.toISOString()
            : new Date().toISOString(),
          seen: message.seen || false,
        };

        console.log(`Emitting receiveMessage to room: ${receiver}`);
        io.to(receiver).emit("receiveMessage", messagePayload);

        const notification = await Notification.create({
          recipient: receiver,
          type: "chat",
          message: `New message from ${sender}`,
          link: `/chat/${chatId}`,
        });

        console.log(`Emitting newNotification to room: ${receiver}`);
        io.to(receiver).emit("newNotification", notification);
      } catch (error) {
        console.error("Error handling sendMessage:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  return io;
}

module.exports = setupSocket;
