const ActivityLog = require("../../model/activityLog");

const Booking = require("../../model/booking");

exports.getAllActivityLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .sort({ createdAt: -1 })
      .limit(50) // latest 50 logs
      .populate("createdBy", "name email");
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch activity logs" });
  }
};

exports.createActivityLog = async (
  type,
  message,
  createdBy = null,
  data = {}
) => {
  try {
    const log = new ActivityLog({ type, message, createdBy, data });
    await log.save();
  } catch (err) {
    console.error("Failed to log activity:", err.message);
  }
};

exports.getTotalMonthlyEarningsAllOwners = async (req, res) => {
  try {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1); // Jan 1
    const endOfYear = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59); // Dec 31

    // Aggregate monthly earnings for all bookings with approved/completed status
    const earnings = await Booking.aggregate([
      {
        $match: {
          status: { $in: ["approved", "completed"] },
          bookingDate: { $gte: startOfYear, $lte: endOfYear },
        },
      },
      {
        $group: {
          _id: { $month: "$bookingDate" },
          totalEarnings: { $sum: "$totalPrice" },
          bookingCount: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Format result to ensure all months are present
    const formatted = Array.from({ length: 12 }, (_, i) => {
      const monthData = earnings.find((e) => e._id === i + 1);
      return {
        month: new Date(0, i).toLocaleString("default", { month: "short" }),
        totalEarnings: monthData?.totalEarnings || 0,
        bookingCount: monthData?.bookingCount || 0,
      };
    });

    res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (err) {
    console.error("Error fetching total monthly earnings for all owners", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
