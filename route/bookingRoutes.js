const express = require("express");
const router = express.Router();

// Controllers
const bookingController = require("../controller/bookingController");

// Middlewares
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");

// Validations
const { settleBalanceSchema } = require("../validators/bookingValidators");

/* ========================
   PUBLIC
======================== */
router.get("/top-venues", bookingController.getTopVenuesByBooking);

router.use(protectRoute);

/* ========================
   CUSTOMER
======================== */
router.get("/my-bookings", authorizeRoles("Customer"), bookingController.getBookingsForCustomer);
router.get("/my-count", authorizeRoles("Customer"), bookingController.getCustomerBookingCount);

/* ========================
   SHARED (ownership enforced in the service)
======================== */
router.put("/:id/cancel", bookingController.cancelBooking);

/* ========================
   VENUE OWNER
======================== */
router.get("/owner-bookings", authorizeRoles("VenueOwner"), bookingController.getBookingsForOwner);
router.get("/owner-earnings", authorizeRoles("VenueOwner"), bookingController.getMonthlyEarningsForOwner);
router.get("/owner-count", authorizeRoles("VenueOwner"), bookingController.getTotalBookingsForOwner);
router.put("/:id/complete", authorizeRoles("VenueOwner", "Admin"), bookingController.completeBooking);
router.put(
  "/:id/settle-balance",
  authorizeRoles("VenueOwner"),
  validate(settleBalanceSchema),
  bookingController.settleBalance
);

/* ========================
   ADMIN
======================== */
router.get("/total", authorizeRoles("Admin"), bookingController.getTotalBookings);

module.exports = router;
