const express = require("express");
const router = express.Router();
const paymentController = require("../controller/paymentController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { initiatePaymentSchema } = require("../validators/paymentValidators");
const { paymentLimiter } = require("../middleware/rateLimiters");

// Protect all payment routes
router.use(protectRoute);

router.post(
  "/initiate",
  paymentLimiter,
  authorizeRoles("Customer", "Admin"),
  validate(initiatePaymentSchema, "body"),
  paymentController.createPaymentIntent
);

module.exports = router;