const express = require("express");
const router = express.Router();
const paymentController = require("../controller/paymentController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { initiateDepositSchema, verifyEsewaSchema } = require("../validators/paymentValidators");
const { paymentLimiter } = require("../middleware/rateLimiters");

// Protect all payment routes
router.use(protectRoute);

router.post(
  "/initiate-deposit",
  paymentLimiter,
  authorizeRoles("Customer", "Admin"),
  validate(initiateDepositSchema, "body"),
  paymentController.initiateDeposit
);

router.post(
  "/esewa/verify",
  paymentLimiter,
  authorizeRoles("Customer", "Admin"),
  validate(verifyEsewaSchema, "body"),
  paymentController.verifyEsewa
);

module.exports = router;
