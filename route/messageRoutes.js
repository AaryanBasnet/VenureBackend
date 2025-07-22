const express = require("express");
const router = express.Router();

const { getChatMessages, getUserMessages } = require("../controller/messageController");
const { authenticateUser } = require("../middleware/authorizedUser");

router.get("/:chatId", authenticateUser, getChatMessages);
router.get("/user/all", authenticateUser, getUserMessages);

module.exports = router;
