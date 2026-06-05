const express = require("express");
const router = express.Router();
const chatController = require("../controller/chatController");

const { protectRoute } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { createChatSchema, chatIdParamSchema } = require("../validators/chatValidators");

router.use(protectRoute);

router.get("/", chatController.getUserChats);
router.get("/unread-count", chatController.getUnreadMessageCount);
router.post("/", validate(createChatSchema, "body"), chatController.getOrCreateChat);
router.get("/:chatId/messages", validate(chatIdParamSchema, "params"), chatController.getChatMessages);

module.exports = router;