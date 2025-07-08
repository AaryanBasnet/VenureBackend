const Message = require("../model/message")
const Chat = require("../model/chat");

function setupSocket(server) {
  const io = require("socket.io")(server, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    console.log("New socket connection");

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
    });

    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });
}

module.exports = setupSocket;
