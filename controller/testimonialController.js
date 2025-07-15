// controller/testimonial.js
const Booking = require("../model/booking");
const Venue = require("../model/venue");
const Testimonial = require("../model/testimonial")

exports.getBookedVenuesForTestimonial = async (req, res) => {
  try {
    const customerId = req.user._id;

    const bookings = await Booking.find({
      customer: customerId,
      status: { $in: ["approved", "completed"] },
    }).populate("venue", "venueName");

    const uniqueVenues = [
      ...new Map(bookings.map((b) => [b.venue._id.toString(), b.venue])).values(),
    ];

    res.status(200).json({ success: true, data: uniqueVenues });
  } catch (err) {
    console.error("Failed to fetch booked venues", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createTestimonial = async (req, res) => {
  try {
    const { venue, rating, comment } = req.body;
    const userId = req.user._id;

    if (!venue || !rating || !comment) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const newTestimonial = new Testimonial({
      venue,
      user: userId,
      rating,
      comment,
    });

    await newTestimonial.save();

    res.status(201).json({ success: true, message: "Testimonial submitted!" });
  } catch (err) {
    console.error("Create testimonial error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAllTestimonials = async (req, res) => {
  try {
    const testimonials = await Testimonial.find()
      .populate("user", "name avatar")
      .populate("venue", "venueName");

    res.status(200).json({ success: true, data: testimonials });
  } catch (err) {
    console.error("Fetch all testimonials error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getTopTestimonial = async (req, res) => {
  try {
    const top = await Testimonial.findOne()
      .sort({ rating: -1 })
      .populate("user", "name avatar")
      .populate("venue", "venueName");

    res.status(200).json({ success: true, data: top });
  } catch (err) {
    console.error("Fetch top testimonial error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


