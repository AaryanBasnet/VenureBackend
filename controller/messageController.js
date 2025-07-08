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

module.exports = {
  getChatMessages,
};
