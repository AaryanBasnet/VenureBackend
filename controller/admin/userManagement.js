const User = require("../../model/user");
const bcrypt = require("bcryptjs");
const Booking = require("../../model/booking");

exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Fetch users with pagination
    const users = await User.find({}).skip(skip).limit(limit).lean(); // use lean to get plain JS objects for aggregation

    // Get user IDs for aggregation
    const userIds = users.map((u) => u._id);

    // Aggregate booking counts per user
    const bookingsCount = await Booking.aggregate([
      { $match: { customer: { $in: userIds } } },
      { $group: { _id: "$customer", count: { $sum: 1 } } },
    ]);

    // Map booking counts by user id for quick lookup
    const bookingCountMap = {};
    bookingsCount.forEach((b) => {
      bookingCountMap[b._id.toString()] = b.count;
    });

    // Attach booking count to each user
    const usersWithBookingCount = users.map((user) => ({
      ...user,
      bookingCount: bookingCountMap[user._id.toString()] || 0,
    }));

    // Total user count for pagination metadata
    const totalUsers = await User.countDocuments();

    res.status(200).json({
      success: true,
      data: usersWithBookingCount,
      pagination: {
        total: totalUsers,
        page,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching users", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getOneUser = async (req, res) => {
  try {
    const _id = req.params.id; // use mongo id
    const user = await User.findById(_id);
    return res.status(200).json({
      success: true,
      message: "One user fetched",
      data: user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};


exports.deleteUser = async (req, res) => {
  const _id = req.params.id;
  try {
    const user = await User.deleteOne({ _id: _id });
    return res
      .status(200)
      .json({ success: true, msg: "User Deleted Successfully" });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, msg: "Internal Server Error" });
  }
};
