const Message = require("../model/message");
const Chat = require("../model/chat");
const Notification = require("../model/notification");
const User = require("../model/user");

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
        console.warn(`Invalid sendMessage payload from socket ${socket.id}:`, {
          chatId,
          sender,
          receiver,
          text,
        });
        return;
      }

      console.log(
        `sendMessage from userId ${sender} to userId ${receiver}: ${text}`
      ); // Keep this for clarity, showing IDs

      try {
        // --- FETCH SENDER'S USERNAME ---
        const senderUser = await User.findById(sender).select("name"); // Fetch only the username field
        if (!senderUser) {
          console.error(`Sender user with ID ${sender} not found.`);
          // Optionally, emit an error back to the sender
          socket.emit("sendMessageError", { error: "Sender user not found." });
          return;
        }
        const senderUsername = senderUser.name;
        // ---------------------------------

        const message = new Message({ chatId, sender, receiver, text });
        await message.save();

        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: { text, timestamp: new Date() },
        });

        // Prepare full message payload for client
        const messagePayload = {
          _id: message._id.toString(),
          chatId,
          senderId: sender, // Include original sender ID
          senderUsername: senderUsername, // <--- ADD SENDER USERNAME HERE
          receiverId: receiver, // Include original receiver ID
          text,
          timestamp: message.createdAt
            ? message.createdAt.toISOString()
            : new Date().toISOString(),
          seen: message.seen || false,
        };

        // --- UPDATE CONSOLE LOG WITH USERNAME ---
        console.log(
          `Emitting receiveMessage to room: ${receiver} from ${senderUsername}`
        );
        // ----------------------------------------
        io.to(receiver).emit("receiveMessage", messagePayload);

        const notification = await Notification.create({
          recipient: receiver,
          type: "chat",
          // --- USE SENDER USERNAME IN NOTIFICATION MESSAGE ---
          message: `New message from ${senderUsername}`,
          // ---------------------------------------------------
          link: `/chat/${chatId}`,
        });

        console.log(`Emitting newNotification to room: ${receiver}`);
        io.to(receiver).emit("newNotification", notification);
      } catch (error) {
        console.error("Error handling sendMessage:", error);
        // Optionally, emit an error back to the sender
        socket.emit("sendMessageError", {
          chatId,
          error: "Failed to send message. Please try again.",
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  return io;
}

module.exports = setupSocket;
