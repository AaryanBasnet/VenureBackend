const express = require("express");
const router = express.Router();
const bookingController = require("../controller/bookingController");

// Middlewares
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");

// Zod Schemas
const { createBookingSchema } = require("../validators/bookingValidators");

/* ========================
   PUBLIC ROUTES
======================== */
router.get("/top-venues", bookingController.getTopVenuesByBooking);

// All booking routes below require authentication
router.use(protectRoute);

/* ========================
   CUSTOMER ROUTES
======================== */
router.post(
  "/",
  authorizeRoles("Customer", "Admin"),
  validate(createBookingSchema, "body"), // ✨ Zod catches bad data before it hits the controller
  bookingController.createBooking
);

router.get("/my-bookings", authorizeRoles("Customer"), bookingController.getBookingsForCustomer);
router.get("/my-count", authorizeRoles("Customer"), bookingController.getCustomerBookingCount);
router.put("/:id/cancel", authorizeRoles("Customer", "Admin"), bookingController.cancelBooking);

/* ========================
   VENUE OWNER ROUTES
======================== */
router.get("/owner-bookings", authorizeRoles("VenueOwner"), bookingController.getBookingsForOwner);
router.get("/owner-earnings", authorizeRoles("VenueOwner"), bookingController.getMonthlyEarningsForOwner);
router.get("/owner-count", authorizeRoles("VenueOwner"), bookingController.getTotalBookingsForOwner);
router.put("/:id/approve", authorizeRoles("VenueOwner"), bookingController.approveBooking);

/* ========================
   ADMIN / GLOBAL ROUTES
======================== */
router.get("/total", authorizeRoles("Admin"), bookingController.getTotalBookings);

module.exports = router;