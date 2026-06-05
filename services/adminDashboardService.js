const ActivityLog = require("../model/activityLog");
const Booking = require("../model/booking");
const logger = require("../utils/logger");

/* =========================================================================
   ACTIVITY LOGS
========================================================================= */
const createActivityLog = async (type, message, createdBy = null, data = {}) => {
  try {
    // We don't throw an error here because logging shouldn't crash the main app flow
    await ActivityLog.create({ type, message, createdBy, data });
  } catch (err) {
    logger.error({ message: "Failed to log activity", error: err.message });
  }
};

const getRecentActivityLogs = async (limit = 50) => {
  return await ActivityLog.find()
    .sort("-createdAt")
    .limit(limit)
    .populate("createdBy", "name email");
};

/* =========================================================================
   GLOBAL ADMIN STATISTICS
========================================================================= */
const getGlobalMonthlyEarnings = async () => {
  const currentYear = new Date().getFullYear();
  const startOfYear = new Date(currentYear, 0, 1); 
  const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59); 

  const earnings = await Booking.aggregate([
    {
      $match: {
        status: { $in: ["approved", "completed"] },
        // ✨ BUG FIX: Using the new startTime field instead of bookingDate
        startTime: { $gte: startOfYear, $lte: endOfYear }, 
      },
    },
    {
      $group: {
        _id: { $month: "$startTime" }, // ✨ BUG FIX
        totalEarnings: { $sum: "$totalPrice" },
        bookingCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Format result to ensure all 12 months are present, even if earnings are 0
  return Array.from({ length: 12 }, (_, i) => {
    const monthData = earnings.find((e) => e._id === i + 1);
    return {
      month: new Date(0, i).toLocaleString("default", { month: "short" }),
      totalEarnings: monthData?.totalEarnings || 0,
      bookingCount: monthData?.bookingCount || 0,
    };
  });
};

module.exports = {
  createActivityLog,
  getRecentActivityLogs,
  getGlobalMonthlyEarnings,
};