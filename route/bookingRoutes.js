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
  getTopVenuesByBooking

} = require("../controller/bookingController");
const { authenticateUser } = require("../middleware/authorizedUser");

// GET /api/bookings/count

router.get("/owner", authenticateUser, getBookingsForOwner);
router.get("/count", authenticateUser, getCustomerBookingCount);
router.get("/my-bookings", authenticateUser, getBookingsForCustomer);
router.post("/createBooking", createBooking);
router.put("/:id/cancel", authenticateUser, cancelBooking);
router.put("/:id/approve", authenticateUser, approveBooking);
router.get(
  "/owner/monthly-earning",
  authenticateUser,
  getMonthlyEarningsForOwner
);
router.get("/owner/total", authenticateUser, getTotalBookingsForOwner);
router.get("/admin/total", authenticateUser, getTotalBookings);
router.post(
  "/venues/approved-bookings-count",
  authenticateUser,
  getApprovedBookingsForVenue
);
router.get("/top-venues",  getTopVenuesByBooking);

module.exports = router;
