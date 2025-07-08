const express = require("express");
const router = express.Router();

const {getUserChats, getOrCreateChat} = require('../controller/chatController')
const { authenticateUser } = require("../middleware/authorizedUser");


router.get("/", authenticateUser, getUserChats);
router.post("/", authenticateUser, getOrCreateChat);

module.exports = router;
