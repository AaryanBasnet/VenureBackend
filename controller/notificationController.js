
const Notification = require("../model/notification");

// GET /notification - get all notifications for logged-in user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    const notifications = await Notification.find({ recipient: userId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

// PATCH /notification/:id/read - mark a single notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    await Notification.findByIdAndUpdate(id, { read: true });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
};

// PATCH /notification/read-all - mark all as read for user
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany({ recipient: userId, read: false }, { read: true });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to mark all as read" });
  }
};
