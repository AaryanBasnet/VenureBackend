const Chat = require("../model/chat");
const Message = require("../model/message");
const User = require("../model/user");
const Notification = require("../model/notification");
const AppError = require("../utils/AppError");

const getUserChats = async (userId, venueId) => {
  const query = { participants: userId };
  if (venueId) query.venueId = venueId;

  return await Chat.find(query)
    .populate("participants", "name role avatar")
    .populate("venueId", "venueName venueImages")
    .sort("-updatedAt"); 
};

const getOrCreateChat = async (userId, participantId, venueId) => {
  let chat = await Chat.findOne({
    participants: { $all: [userId, participantId] },
    venueId: venueId,
  }).populate("participants", "name role avatar").populate("venueId", "venueName");

  if (!chat) {
    chat = await Chat.create({
      participants: [userId, participantId],
      venueId: venueId,
    });
    await chat.populate("participants", "name role avatar");
    await chat.populate("venueId", "venueName");
  }

  return chat;
};

const getChatMessages = async (chatId, userId) => {
  // SECURITY CHECK: Verify the chat exists AND the user is a participant
  const chat = await Chat.findOne({ _id: chatId, participants: userId });
  if (!chat) throw new AppError("Chat not found or unauthorized", 403);

  return await Message.find({ chatId })
    .sort("createdAt")
    .populate("sender receiver", "name avatar");
};

const getUnreadMessageCount = async (userId) => {
  return await Message.countDocuments({ receiver: userId, seen: false });
};

// Handle real-time socket message saving securely
const saveMessage = async (chatId, senderId, receiverId, text) => {
  const chat = await Chat.findOne({ _id: chatId, participants: senderId });
  if (!chat) throw new AppError("Chat not found or unauthorized", 403);

  const senderUser = await User.findById(senderId).select("name");
  if (!senderUser) throw new AppError("Sender not found", 404);

  const message = await Message.create({
    chatId,
    sender: senderId,
    receiver: receiverId,
    text,
  });

  chat.updatedAt = new Date();
  await chat.save();

  const notification = await Notification.create({
    recipient: receiverId,
    type: "chat",
    message: `New message from ${senderUser.name}`,
    link: `/chat/${chatId}`,
  });

  return {
    messagePayload: {
      _id: message._id.toString(),
      chatId,
      senderId,
      senderUsername: senderUser.name,
      receiverId,
      text,
      timestamp: message.createdAt.toISOString(),
      seen: false,
    },
    notificationPayload: notification,
  };
};

module.exports = {
  getUserChats,
  getOrCreateChat,
  getChatMessages,
  getUnreadMessageCount,
  saveMessage,
};