const Message = require("../model/message");

const getChatMessages = async (req, res) => {
  try {
    const messages = await Message.find({ chatId: req.params.chatId })
      .sort("createdAt")
      .populate("sender receiver", "name");
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


const getUserMessages = async (req, res) => {
  try {
    const userId = req.user._id; // assuming authenticateUser middleware adds user info

    // Find messages where user is either sender or receiver
    const messages = await Message.find({
      $or: [{ sender: userId }, { receiver: userId }],
    })
      .sort("createdAt")
      .populate("sender receiver", "name venueId");

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getChatMessages,
  getUserMessages
};
