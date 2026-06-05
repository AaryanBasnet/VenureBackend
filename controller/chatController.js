const asyncHandler = require("../utils/asyncHandler");
const chatService = require("../services/chatService");

exports.getUserChats = asyncHandler(async (req, res) => {
  const chats = await chatService.getUserChats(req.user._id, req.query.venueId);
  res.status(200).json({ success: true, data: chats });
});

exports.getOrCreateChat = asyncHandler(async (req, res) => {
  const { participantId, venueId } = req.body;
  const chat = await chatService.getOrCreateChat(req.user._id, participantId, venueId);
  
  res.status(200).json({ success: true, data: chat });
});

exports.getChatMessages = asyncHandler(async (req, res) => {
  const messages = await chatService.getChatMessages(req.params.chatId, req.user._id);
  res.status(200).json({ success: true, data: messages });
});

exports.getUnreadMessageCount = asyncHandler(async (req, res) => {
  const count = await chatService.getUnreadMessageCount(req.user._id);
  res.status(200).json({ success: true, data: { unreadCount: count } });
});