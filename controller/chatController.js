const Chat = require("../model/chat");

const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id;
    const { venueId } = req.query;

    const query = {
      participants: userId,
    };

    if (venueId) {
      query.venueId = venueId;
    }

    const chats = await Chat.find(query)
      .populate("participants", "name role")
      .populate("venueId", "venueName");

    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getOrCreateChat = async (req, res) => {
  const { participantId, venueId } = req.body;
  const userId = req.user._id;

  try {
    let chat = await Chat.findOne({
      participants: { $all: [userId, participantId] },
      venueId,
    });

    if (!chat) {
      chat = new Chat({ participants: [userId, participantId], venueId });
      await chat.save();
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
module.exports = {
  getUserChats,
  getOrCreateChat,
};
