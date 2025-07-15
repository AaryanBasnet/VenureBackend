const express = require("express");
const router = express.Router();
const {
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
} = require("../controller/bookingController");

const { authenticateUser, isOwner, isAdmin, authorizeBookingOwner } = require("../middleware/authorizedUser");

// Owner bookings
router.get("/owner", authenticateUser, isOwner, getBookingsForOwner);

// Customer bookings count & list
router.get("/count", authenticateUser, getCustomerBookingCount);
router.get("/my-bookings", authenticateUser, getBookingsForCustomer);

// Create booking (customer)
router.post("/createBooking", authenticateUser, createBooking);

// Cancel / Approve booking - only venue owners of the related venue allowed
router.put("/:id/cancel", authenticateUser, isOwner, authorizeBookingOwner, cancelBooking);
router.put("/:id/approve", authenticateUser, isOwner, authorizeBookingOwner, approveBooking);

// Owner stats
router.get("/owner/monthly-earning", authenticateUser, isOwner, getMonthlyEarningsForOwner);
router.get("/owner/total", authenticateUser, isOwner, getTotalBookingsForOwner);

// Admin-only
router.get("/admin/total", authenticateUser, isAdmin, getTotalBookings);
router.post("/venues/approved-bookings-count", authenticateUser, isAdmin, getApprovedBookingsForVenue);

// Public endpoint for top venues by booking
router.get("/top-venues", getTopVenuesByBooking);

module.exports = router;
