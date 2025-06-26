const express = require("express");
const router = express.Router();
const { getCustomerBookingCount, createBooking } = require("../controller/bookingController");
const { authenticateUser } = require("../middleware/authorizedUser");

// GET /api/bookings/count
router.get("/count", authenticateUser, getCustomerBookingCount);
router.post("/createBooking", createBooking);
module.exports = router;
