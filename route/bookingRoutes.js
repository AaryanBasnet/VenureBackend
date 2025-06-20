const express = require("express");
const router = express.Router();
const { getCustomerBookingCount } = require("../controller/bookingController");
const { authenticateUser } = require("../middleware/authorizedUser");

// GET /api/bookings/count
router.get("/count", authenticateUser, getCustomerBookingCount);

module.exports = router;
