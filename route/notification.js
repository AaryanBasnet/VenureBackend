const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
} = require("../controller/notificationController");
const { authenticateUser } = require("../middleware/authorizedUser");

router.get("/", authenticateUser, getNotifications);
router.patch("/:id/read", authenticateUser, markAsRead);
router.patch("/read-all", authenticateUser, markAllAsRead);

module.exports = router;
