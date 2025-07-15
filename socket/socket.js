const Message = require("../model/message");
const Chat = require("../model/chat");
const Notification = require("../model/notification");

function setupSocket(server) {
  const io = require("socket.io")(server, {
    cors: {
      origin: "*", // change to your frontend origin in production
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("New socket connection:", socket.id);

    socket.on("join", (userId) => {
      socket.join(userId);
    });

    socket.on("sendMessage", async ({ chatId, sender, receiver, text }) => {
      const message = new Message({ chatId, sender, receiver, text });
      await message.save();

      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: { text, timestamp: new Date() },
      });

      io.to(receiver).emit("receiveMessage", {
        chatId,
        sender,
        text,
        timestamp: new Date(),
      });

      const notification = await Notification.create({
        recipient: receiver,
        type: "chat",
        message: `New message from ${sender}`,
        link: `/chat/${chatId}`,
      });

      io.to(receiver).emit("newNotification", notification);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  return io;
}

module.exports = setupSocket;
