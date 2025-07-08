const express = require("express");
const router = express.Router();

const { getChatMessages } = require("../controller/messageController");
const { authenticateUser } = require("../middleware/authorizedUser");

router.get("/:chatId", authenticateUser, getChatMessages);

module.exports = router;
