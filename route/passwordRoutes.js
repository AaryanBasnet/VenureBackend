const express = require("express");
const router = express.Router();

// Controllers
const passwordController = require("../controller/passwordController");

// Middlewares
const validate = require("../middleware/validateMiddleware");
const { protectRoute } = require("../middleware/authMiddleware");
const { forgotPasswordLimiter } = require("../middleware/rateLimiter");

// Validations
const { forgotPasswordSchema, resetPasswordSchema } = require("../validations/authSchemas");

/* ========================
   PUBLIC PASSWORD RECOVERY
======================== */
router.post(
  "/forgot-password", 
  forgotPasswordLimiter, 
  validate(forgotPasswordSchema), 
  passwordController.forgotPassword
);

router.post("/verify-code", passwordController.verifyResetCode);

router.post(
  "/reset-password", 
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
  passwordController.verifyPassword
);

module.exports = router;