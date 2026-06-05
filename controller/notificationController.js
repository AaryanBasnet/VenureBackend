const asyncHandler = require("../utils/asyncHandler");
const notificationService = require("../services/notificationService");

exports.getNotifications = asyncHandler(async (req, res) => {
  const notifications = await notificationService.getUserNotifications(req.user._id);

  res.status(200).json({
    success: true,
    data: notifications,
  });
});

exports.markAsRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.params.id, req.user._id);

  res.status(200).json({
    success: true,
    data: notification,
  });
});

exports.markAllAsRead = asyncHandler(async (req, res) => {
  await notificationService.markAllAsRead(req.user._id);

  res.status(200).json({
    success: true,
    message: "All notifications marked as read",
  });
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  await notificationService.deleteNotification(req.params.id, req.user._id);

  res.status(200).json({
    success: true,
    message: "Notification deleted",
  });
});