const User = require("../model/User");
const AppError = require("../utils/AppError");
const { cloudinary } = require("../middleware/uploadMiddleware");
const logger = require("../utils/logger");

const getUserProfile = async (userId) => {
  const user = await User.findById(userId); 
  if (!user) throw new AppError("User not found", 404);
  return user;
};

const updateUserProfile = async (userId, updateData, file) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  // If the Cloudinary multer middleware processed an image, it attaches the secure URL to `file.path`
  if (file) {
    // 1. Delete the old avatar from Cloudinary (if it exists) to save storage space
    if (user.avatar && user.avatar.includes("cloudinary")) {
      try {
        // Extract the public_id from the URL (e.g., "venure/users/filename")
        const urlParts = user.avatar.split("/");
        const filename = urlParts[urlParts.length - 1].split(".")[0];
        await cloudinary.uploader.destroy(`venure/users/${filename}`);
      } catch (err) {
        logger.error({ message: "Failed to delete old avatar from Cloudinary", error: err.message });
      }
    }
    
    // 2. Set the new Cloudinary URL
    updateData.avatar = file.path;
  }

  // Update the database
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  return updatedUser;
};

/* =========================================================================
   ADMIN USER MANAGEMENT
========================================================================= */
const getPaginatedUsers = async (filters) => {
  const { page, limit, search, role } = filters;
  const skip = (page - 1) * limit;

  // Build the query: Exclude soft-deleted users
  let query = { isDeleted: { $ne: true } };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  if (role) query.role = role;

  // Fetch users
  const users = await User.find(query).skip(skip).limit(limit).lean();
  const totalUsers = await User.countDocuments(query);

  // Aggregate bookings for these users
  const userIds = users.map((u) => u._id);
  const bookingsCount = await Booking.aggregate([
    { $match: { customer: { $in: userIds } } },
    { $group: { _id: "$customer", count: { $sum: 1 } } },
  ]);

  const bookingCountMap = {};
  bookingsCount.forEach((b) => {
    bookingCountMap[b._id.toString()] = b.count;
  });

  const usersWithBookingCount = users.map((user) => ({
    ...user,
    bookingCount: bookingCountMap[user._id.toString()] || 0,
  }));

  return {
    data: usersWithBookingCount,
    pagination: { total: totalUsers, page, limit },
  };
};

const getAdminUserById = async (userId) => {
  const user = await User.findOne({ _id: userId, isDeleted: { $ne: true } });
  if (!user) throw new AppError("User not found", 404);
  return user;
};

const softDeleteUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  if (user.role === "Admin") {
    throw new AppError("Cannot delete an Admin account", 403);
  }

  // ENTERPRISE FIX: Soft Delete
  user.isDeleted = true;
  await user.save();
};

const getTotalCustomersCount = async () => {
  return await User.countDocuments({ role: "Customer", isDeleted: { $ne: true } });
};

module.exports = { getUserProfile, updateUserProfile, getPaginatedUsers,
  getAdminUserById,
  softDeleteUser,
  getTotalCustomersCount, };