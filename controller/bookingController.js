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

const createBooking = async (req, res) => {
  try {
    const {
      customer,
      venue,
      bookingDate,
      timeSlot,
      hoursBooked,
      numberOfGuests,
      eventType,
      specialRequirements,
      contactName,
      phoneNumber,
      selectedAddons,
      totalPrice,
      paymentDetails,
    } = req.body;

    // Validation can be added here

    const booking = new Booking({
      customer,
      venue,
      bookingDate,
      timeSlot,
      hoursBooked,
      numberOfGuests,
      eventType,
      specialRequirements,
      contactName,
      phoneNumber,
      selectedAddons,
      totalPrice,
      paymentDetails,
    });

    const savedBooking = await booking.save();
    res.status(201).json({ message: "Booking created", booking: savedBooking });
  } catch (error) {
    res.status(500).json({ message: "Booking creation failed", error: error.message });
  }
};

module.exports = {
  getCustomerBookingCount,
  createBooking
};
