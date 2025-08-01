const express = require("express");
const router = express.Router();

const {
  getChatMessages,
  getUserMessages,
} = require("../controller/messageController");
const { authenticateUser } = require("../middleware/authorizedUser");

router.get("/user/all", authenticateUser, getUserMessages);
router.get("/:chatId", authenticateUser, getChatMessages);

module.exports = router;
