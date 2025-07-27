const User = require("../../model/user");
const bcrypt = require("bcryptjs");
const Booking = require("../../model/booking");

exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim() || "";
    const role = req.query.role?.trim();

    console.log("📥 Incoming Query:", { page, limit, search, role });

    // Build base filter
    let filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    if (role) {
      filter = {
        ...filter,
        role, // Only match users with this role
      };
    }

    console.log("🔍 Final Mongo Filter:", filter);

    // Fetch users
    const users = await User.find(filter).skip(skip).limit(limit).lean();
    console.log(`👤 Fetched ${users.length} users`);

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

    const totalUsers = await User.countDocuments(filter);

    console.log("📦 Final Response:", {
      total: totalUsers,
      returned: usersWithBookingCount.length,
    });

    res.status(200).json({
      success: true,
      data: usersWithBookingCount,
      pagination: { total: totalUsers, page, limit },
    });
  } catch (error) {
    console.error("❌ Error fetching users:", error);
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

exports.getTotalCustomers = async (req, res) => {
  try {
    const totalCustomers = await User.countDocuments({ role: "Customer" }); // or "customer" based on your schema

    res.status(200).json({
      success: true,
      totalCustomers,
    });
  } catch (error) {
    console.error("Error fetching total customers", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
