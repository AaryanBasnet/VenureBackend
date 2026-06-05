const express = require("express");
const router = express.Router();

// Controllers
const authController = require("../controller/authController");

// Middlewares
const validate = require("../middleware/validate");
const { loginLimiter, registerLimiter } = require("../middleware/rateLimiters");

// Validations (Ensure the path matches where you store your Zod schemas)
const { registerSchema, loginSchema } = require("../validators/authValidators"); 

/* ========================
   AUTH ROUTES
======================== */
router.post(
  "/register", 
  registerLimiter, 
  validate(registerSchema), 
  authController.registerUser
);

router.post(
  "/login", 
  loginLimiter, 
  validate(loginSchema), 
  authController.loginUser
);

// Refresh and Logout don't need body validation, just the cookie
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logoutUser);

module.exports = router;