const mongoose = require("mongoose");
const Chat = require("../model/chat");
const Venue = require("../model/venue");
const Message = require("../model/message");
const User = require("../model/user");
const Notification = require("../model/notification");
const AppError = require("../utils/AppError");

const getUserChats = async (userId, venueId) => {
  const query = { participants: userId };
  if (venueId) query.venueId = { $eq: venueId };

  const chats = await Chat.find(query)
    .populate("participants", "name role avatar")
    .populate("venueId", "venueName venueImages")
    .sort("-updatedAt")
    .lean();

  // Add what the conversation list needs: the latest message and how many are unread by this user.
  // The latest message lives on the chat itself (written by saveMessage); chats created before that field
  // existed fall back to one aggregation, limited to just those chats, and are healed on the way out.
  const ids = chats.map((c) => c._id);
  const legacy = chats.filter((c) => !c.lastMessage).map((c) => c._id);
  const [lasts, unread] = await Promise.all([
    legacy.length
      ? Message.aggregate([
          { $match: { chatId: { $in: legacy } } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: "$chatId", text: { $first: "$text" }, timestamp: { $first: "$createdAt" } } },
        ])
      : [],
    ids.length
      ? Message.aggregate([
          { $match: { receiver: new mongoose.Types.ObjectId(String(userId)), seen: false, chatId: { $in: ids } } },
          { $group: { _id: "$chatId", count: { $sum: 1 } } },
        ])
      : [],
  ]);
  const lastBy = new Map(lasts.map((m) => [String(m._id), { text: m.text, timestamp: m.timestamp }]));
  if (lasts.length) {
    // timestamps: false keeps updatedAt (the list order) unchanged
    Chat.bulkWrite(
      lasts.map((m) => ({ updateOne: { filter: { _id: m._id, lastMessage: { $exists: false } }, update: { $set: { lastMessage: { text: m.text, timestamp: m.timestamp } } } } })),
      { timestamps: false, ordered: false }
    ).catch(() => {});
  }
  const unreadBy = new Map(unread.map((m) => [String(m._id), m.count]));

  return chats.map((c) => ({
    ...c,
    lastMessage: c.lastMessage ? { text: c.lastMessage.text, timestamp: c.lastMessage.timestamp } : lastBy.get(String(c._id)) ?? null,
    unreadCount: unreadBy.get(String(c._id)) ?? 0,
  }));
};

const getOrCreateChat = async (userId, participantId, venueId) => {
  if (userId.toString() === participantId.toString()) {
    throw new AppError("You cannot start a chat with yourself", 400);
  }

  // Chats are always about a venue and must include that venue's owner
  const venue = await Venue.findOne({ _id: { $eq: venueId }, isDeleted: false }).select("owner");
  if (!venue) throw new AppError("Venue not found", 404);

  const ownerId = venue.owner.toString();
  if (userId.toString() !== ownerId && participantId.toString() !== ownerId) {
    throw new AppError("Chats must be with the venue owner", 403);
  }

  const participant = await User.exists({ _id: { $eq: participantId }, isDeleted: { $ne: true } });
  if (!participant) throw new AppError("User not found", 404);

  let chat = await Chat.findOne({
    participants: { $all: [userId, participantId] },
    venueId: { $eq: venueId },
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

// A conversation shows its newest MESSAGE_PAGE messages, oldest first (a chat can grow without bound)
const MESSAGE_PAGE = 200;

const getChatMessages = async (chatId, userId, limit = MESSAGE_PAGE) => {
  // SECURITY CHECK: Verify the chat exists AND the user is a participant
  const chat = await Chat.exists({ _id: chatId, participants: userId });
  if (!chat) throw new AppError("Chat not found or unauthorized", 403);

  const newest = await Message.find({ chatId })
    .sort("-createdAt")
    .limit(Math.min(Math.max(Number(limit) || MESSAGE_PAGE, 1), 500))
    .populate("sender receiver", "name avatar")
    .lean();
  return newest.reverse();
};

const getUnreadMessageCount = async (userId) => {
  return await Message.countDocuments({ receiver: userId, seen: false });
};

// Handle real-time socket message saving securely.
// The receiver is always the other participant of the chat, never taken from the client.
const saveMessage = async (chatId, senderId, text) => {
  if (!mongoose.isValidObjectId(chatId)) throw new AppError("Chat not found or unauthorized", 403);

  const chat = await Chat.findOne({ _id: chatId, participants: senderId }).select("participants").lean();
  if (!chat) throw new AppError("Chat not found or unauthorized", 403);

  const receiver = chat.participants.find((p) => p.toString() !== senderId.toString());
  if (!receiver) throw new AppError("Chat has no recipient", 400);
  const receiverId = receiver.toString();

  const senderUser = await User.findById(senderId).select("name").lean();
  if (!senderUser) throw new AppError("Sender not found", 404);

  const message = await Message.create({
    chatId,
    sender: senderId,
    receiver: receiverId,
    text,
  });

  // One atomic update: bumps the conversation to the top of the list and stores the preview.
  // $max keeps a slower, older write from overwriting a newer preview when messages arrive concurrently.
  await Chat.updateOne(
    { _id: chatId },
    [
      {
        $set: {
          lastMessage: {
            $cond: [
              { $gt: [message.createdAt, { $ifNull: ["$lastMessage.timestamp", new Date(0)] }] },
              { text: { $literal: text }, timestamp: message.createdAt },
              "$lastMessage",
            ],
          },
          updatedAt: { $max: [{ $ifNull: ["$updatedAt", new Date(0)] }, message.createdAt] },
        },
      },
    ],
    { timestamps: false }
  );

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