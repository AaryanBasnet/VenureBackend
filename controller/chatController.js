const Chat = require("../model/chat");
 const mongoose = require("mongoose")
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
    // Convert string IDs to ObjectId explicitly
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const participantObjectId = new mongoose.Types.ObjectId(participantId);
    const venueObjectId = new mongoose.Types.ObjectId(venueId);
     // Debug log here:
    console.log('Searching chat with:', {
      userObjectId: userObjectId.toString(),
      participantObjectId: participantObjectId.toString(),
      venueObjectId: venueObjectId.toString(),
    });

    // Correct query key should be 'venueId', not 'venueObjectId'
    let chat = await Chat.findOne({
      participants: { $all: [userObjectId, participantObjectId] },
      venueId: venueObjectId,
    });

    if (!chat) {
      chat = new Chat({
        participants: [userObjectId, participantObjectId],
        venueId: venueObjectId,
      });
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
