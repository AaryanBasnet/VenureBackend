const express = require("express");
const router = express.Router();

// Controllers
const passwordController = require("../controller/passwordController");

// Middlewares
const validate = require("../middleware/validate");
const { protectRoute } = require("../middleware/authMiddleware");
const {
  forgotPasswordLimiter,
  resetCodeLimiter,
  verifyPasswordLimiter,
} = require("../middleware/rateLimiters");

// Validations
const {
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  verifyPasswordSchema,
} = require("../validators/authValidators");

/* ========================
   PUBLIC PASSWORD RECOVERY
======================== */
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  passwordController.forgotPassword
);

router.post(
  "/verify-code",
  resetCodeLimiter,
  validate(verifyResetCodeSchema),
  passwordController.verifyResetCode
);

router.post(
  "/reset-password",
  resetCodeLimiter,
  validate(resetPasswordSchema),
  passwordController.resetPasswordWithCode
);

/* ========================
   PROTECTED SECURITY ROUTES
======================== */
// Requires the user to be actively logged in to verify their current password
router.post(
  "/verify-password",
  protectRoute,
  verifyPasswordLimiter,
  validate(verifyPasswordSchema),
  passwordController.verifyPassword
);

module.exports = router;
