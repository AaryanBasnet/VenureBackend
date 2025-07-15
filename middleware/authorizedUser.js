const Booking = require("../model/booking");
const Venue = require("../model/venue");
const User = require("../model/user");
const jwt = require("jsonwebtoken");

exports.authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  try {
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return res.status(401).json({ success: false, msg: "Access Denied" });
    }
    const token = authHeader.split(" ")[1];
    const verifyToken = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: verifyToken._id });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Token mismatch" });
    }
    req.user = user;
    next();
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, msg: "Internal Server Error" });
  }
};

exports.isAdmin = async (req, res, next) => {
  if (req.user && req.user.role === "Admin") {
    next();
  } else {
    return res
      .status(403)
      .json({ success: false, message: "Admin privilage required" });
  }
};

exports.isOwner = async (req, res, next) => {
  if (req.user && req.user.role === "VenueOwner") {
    next();
  } else {
    return res
      .status(403)
      .json({ success: false, message: "VenueOwner privilage required" });
  }
};


exports.authorizeBookingOwner = async (req, res, next) => {
  try {
    const bookingId = req.params.id;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    const venue = await Venue.findById(booking.venue);
    if (!venue) return res.status(404).json({ success: false, message: "Venue not found" });

    if (venue.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "You do not have permission to modify this booking." });
    }

    next();
  } catch (err) {
    console.error("Authorization error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
