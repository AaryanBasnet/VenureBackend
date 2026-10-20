const ActivityLog = require("../model/activityLog");
const Booking = require("../model/booking");
const logger = require("../utils/logger");
const publicCache = require("../utils/publicCache");
const { demoVenueIds } = require("./demoScope");

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

const getRecentActivityLogs = async (limit = 50, scoped = false) => {
  return await ActivityLog.find(scoped ? { isDemo: true } : {})
    .sort("-createdAt")
    .limit(limit)
    .populate("createdBy", "name email")
    .lean();
};

/* =========================================================================
   GLOBAL ADMIN STATISTICS
========================================================================= */
// The year's earnings are a full-year aggregation over every booking: computed at most once per
// EARNINGS_TTL_MS per process (the dashboard tolerates figures that are a few seconds old). Off under jest.
const EARNINGS_TTL_MS = 30000;
let earningsMemo = null; // { year, at, promise }

const getGlobalMonthlyEarnings = async (scoped = false) => {
  if (scoped) return computeGlobalMonthlyEarnings(await demoVenueIds()); // never cached: it is a different answer
  const year = new Date().getFullYear();
  const useMemo = publicCache.enabled();
  if (useMemo && earningsMemo && earningsMemo.year === year && Date.now() - earningsMemo.at < EARNINGS_TTL_MS) {
    return earningsMemo.promise;
  }
  const promise = computeGlobalMonthlyEarnings();
  if (useMemo) {
    earningsMemo = { year, at: Date.now(), promise };
    promise.catch(() => { if (earningsMemo && earningsMemo.promise === promise) earningsMemo = null; });
  }
  return promise;
};

const computeGlobalMonthlyEarnings = async (onlyVenues = null) => {
  const currentYear = new Date().getFullYear();
  const startOfYear = new Date(currentYear, 0, 1); 
  const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59); 

  const earnings = await Booking.aggregate([
    {
      $match: {
        status: { $in: ["confirmed", "completed"] },
        startTime: { $gte: startOfYear, $lte: endOfYear },
        ...(onlyVenues ? { venue: { $in: onlyVenues } } : {}),
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