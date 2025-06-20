const Booking = require("../model/booking");

const getCustomerBookingCount = async (req, res) => {
  try {
    const customerId = req.user._id;

    const bookingCount = await Booking.countDocuments({ customer: customerId });

    res.status(200).json({
      success: true,
      message: "Total bookings fetched successfully",
      data: bookingCount,
    });
  } catch (err) {
    console.error("Error fetching booking count", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getCustomerBookingCount,
};
