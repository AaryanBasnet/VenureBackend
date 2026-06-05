const express = require("express");
const router = express.Router();

// Controllers
const authController = require("../controller/authController");

// Middlewares
const validate = require("../middleware/validate");
const { protectRoute } = require("../middleware/authMiddleware");
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

// Cookie-based token rotation — no body validation needed
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logoutUser);

// Returns the currently authenticated user (hydrates client store on load)
router.get("/me", protectRoute, authController.getMe);

module.exports = router;