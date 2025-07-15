const Booking = require("../model/booking");
const Venue = require("../model/venue");
const mongoose = require("mongoose");
const { getAllApprovedVenues } = require("./user/userVenueController");

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

    const conflict = await Booking.findOne({
      venue,
      bookingDate: new Date(bookingDate),
      timeSlot,
      status: { $in: ["booked", "approved"] },
    });

    if (conflict) {
      return res.status(400).json({
        success: false,
        message: "This time slot is already booked for the selected venue.",
      });
    }

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
    res
      .status(500)
      .json({ message: "Booking creation failed", error: error.message });
  }
};

const getBookingsForOwner = async (req, res) => {
  try {
    const ownerId = req.user._id; // from auth middleware

    // Step 1: Find venues owned by this owner
    const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
    const venueIds = ownerVenues.map((v) => v._id);

    // Step 2: Find bookings for these venues
    const bookings = await Booking.find({ venue: { $in: venueIds } })
      .populate("venue")
      .populate("customer");

    return res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (err) {
    console.error("Error fetching owner's bookings", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bookings for owner",
    });
  }
};

// Cancel booking by ID
const cancelBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    booking.status = "cancelled";
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      booking,
    });
  } catch (err) {
    console.error("Cancel booking error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Approve booking by ID
const approveBooking = async (req, res) => {
  try {
    const bookingId = req.params.id;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    booking.status = "approved";
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Booking approved successfully",
      booking,
    });
  } catch (err) {
    console.error("Approve booking error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get bookings for the logged-in customer
const getBookingsForCustomer = async (req, res) => {
  try {
    const customerId = req.user._id;

    const bookings = await Booking.find({ customer: customerId }).populate(
      "venue"
    );

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (err) {
    console.error("Error fetching customer bookings:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
const getMonthlyEarningsForOwner = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
    const venueIds = ownerVenues.map((v) => v._id);

    const startOfYear = new Date(new Date().getFullYear(), 0, 1); // Jan 1
    const endOfYear = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59); // Dec 31

    const earnings = await Booking.aggregate([
      {
        $match: {
          venue: { $in: venueIds },
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
    console.error("Error in getMonthlyEarningsForOwner", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getTotalBookingsForOwner = async (req, res) => {
  try {
    const ownerId = req.user._id;

    // Find all venues owned by this owner
    const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
    const venueIds = ownerVenues.map((v) => v._id);

    // Count bookings related to these venues with status approved/completed (or all)
    const totalBookings = await Booking.countDocuments({
      venue: { $in: venueIds },
      status: { $in: ["approved", "completed"] }, // adjust status filter as needed
    });

    res.status(200).json({
      success: true,
      data: totalBookings,
    });
  } catch (err) {
    console.error("Error fetching total bookings for owner", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getTotalBookings = async (req, res) => {
  try {
    const totalBookings = await Booking.countDocuments(); // counts all
    res.status(200).json({
      success: true,
      message: "Total bookings fetched successfully",
      data: totalBookings,
    });
  } catch (err) {
    console.error("Error fetching total bookings:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// controller/booking.js
const getApprovedBookingsForVenue = async (req, res) => {
  try {
    const { venueIds } = req.body;

    const counts = await Booking.aggregate([
      {
        $match: {
          venue: { $in: venueIds.map((id) => new mongoose.Types.ObjectId(id)) },
          status: "approved",
        },
      },
      {
        $group: {
          _id: "$venue",
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {};
    venueIds.forEach((id) => {
      result[id] = counts.find((c) => c._id.toString() === id)
        ? counts.find((c) => c._id.toString() === id).count
        : 0;
    });

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("Bulk booking count fetch error", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getTopVenuesByBooking = async (req, res) => {
  try {
    const topVenues = await Booking.aggregate([
      {
        $group: {
          _id: "$venue",
          bookingCount: { $sum: 1 },
        },
      },
      {
        $sort: { bookingCount: -1 },
      },
      {
        $limit: 5,
      },
      {
        $lookup: {
          from: "venues", // Collection name in MongoDB (usually plural lowercase)
          localField: "_id",
          foreignField: "_id",
          as: "venueDetails",
        },
      },
      {
        $unwind: "$venueDetails",
      },
      {
        $project: {
          _id: 0,
          venueId: "$venueDetails._id",
          venueName: "$venueDetails.venueName",
          location: "$venueDetails.location",
          averageRating: "$venueDetails.averageRating",
          capacity: "$venueDetails.capacity",
          venueImages: "$venueDetails.venueImages",
          pricePerHour: "$venueDetails.pricePerHour",
          amenities: "$venueDetails.amenities",

          bookingCount: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      message: "Top 5 venues by bookings",
      data: topVenues,
    });
  } catch (err) {
    console.error("Error fetching top venues:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getCustomerBookingCount,
  createBooking,
  getBookingsForOwner,
  cancelBooking,
  approveBooking,
  getBookingsForCustomer,
  getMonthlyEarningsForOwner,
  getTotalBookingsForOwner,
  getTotalBookings,
  getApprovedBookingsForVenue,
  getTopVenuesByBooking,
};
