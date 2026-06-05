const Notification = require("../model/Notification");
const AppError = require("../utils/AppError");

const getUserNotifications = async (userId, limit = 50) => {
  return await Notification.find({ recipient: userId })
    .sort("-createdAt")
    .limit(limit);
};

const markAsRead = async (notificationId, userId) => {
  // ENTERPRISE FIX: Must check BOTH the ID and the Recipient
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId }, 
    { read: true },
    { new: true }
  );

  if (!notification) {
    throw new AppError("Notification not found or unauthorized", 404);
  }

  return notification;
};

const markAllAsRead = async (userId) => {
  await Notification.updateMany(
    { recipient: userId, read: false }, 
    { read: true }
  );
};

const deleteNotification = async (notificationId, userId) => {
  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    recipient: userId,
  });

  if (!notification) {
    throw new AppError("Notification not found or unauthorized", 404);
  }
};

module.exports = {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};