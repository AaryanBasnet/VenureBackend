const mongoose = require("mongoose");
const Chat = require("../model/chat");
const Venue = require("../model/venue");
const Message = require("../model/message");
const User = require("../model/user");
const Notification = require("../model/notification");
const AppError = require("../utils/AppError");

const getUserChats = async (userId, venueId) => {
  const query = { participants: userId };
  if (venueId) query.venueId = venueId;

  const chats = await Chat.find(query)
    .populate("participants", "name role avatar")
    .populate("venueId", "venueName venueImages")
    .sort("-updatedAt")
    .lean();

  // Add what the conversation list needs: the latest message and how many are unread by this user.
  const ids = chats.map((c) => c._id);
  const [lasts, unread] = await Promise.all([
    Message.aggregate([
      { $match: { chatId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$chatId", text: { $first: "$text" }, timestamp: { $first: "$createdAt" } } },
    ]),
    Message.aggregate([
      { $match: { chatId: { $in: ids }, receiver: new mongoose.Types.ObjectId(String(userId)), seen: false } },
      { $group: { _id: "$chatId", count: { $sum: 1 } } },
    ]),
  ]);
  const lastBy = new Map(lasts.map((m) => [String(m._id), { text: m.text, timestamp: m.timestamp }]));
  const unreadBy = new Map(unread.map((m) => [String(m._id), m.count]));

  return chats.map((c) => ({ ...c, lastMessage: lastBy.get(String(c._id)) ?? null, unreadCount: unreadBy.get(String(c._id)) ?? 0 }));
};

const getOrCreateChat = async (userId, participantId, venueId) => {
  if (userId.toString() === participantId.toString()) {
    throw new AppError("You cannot start a chat with yourself", 400);
  }

  // Chats are always about a venue and must include that venue's owner
  const venue = await Venue.findOne({ _id: venueId, isDeleted: false }).select("owner");
  if (!venue) throw new AppError("Venue not found", 404);

  const ownerId = venue.owner.toString();
  if (userId.toString() !== ownerId && participantId.toString() !== ownerId) {
    throw new AppError("Chats must be with the venue owner", 403);
  }

  const participant = await User.exists({ _id: participantId, isDeleted: { $ne: true } });
  if (!participant) throw new AppError("User not found", 404);

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

// Handle real-time socket message saving securely.
// The receiver is always the other participant of the chat, never taken from the client.
const saveMessage = async (chatId, senderId, text) => {
  if (!mongoose.isValidObjectId(chatId)) throw new AppError("Chat not found or unauthorized", 403);

  const chat = await Chat.findOne({ _id: chatId, participants: senderId });
  if (!chat) throw new AppError("Chat not found or unauthorized", 403);

  const receiver = chat.participants.find((p) => p.toString() !== senderId.toString());
  if (!receiver) throw new AppError("Chat has no recipient", 400);
  const receiverId = receiver.toString();

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
    receiverId,
  };
};

module.exports = {
  getUserChats,
  getOrCreateChat,
  getChatMessages,
  getUnreadMessageCount,
  saveMessage,
};