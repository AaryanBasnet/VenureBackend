const rateLimit = require("express-rate-limit");

/**
 * Login rate limiter
 * Prevents brute-force credential stuffing
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // 5 attempts per IP
  message: {
    success: false,
    message: "Too many login attempts. Try again later.",
  },
});

/**
 * Forgot password limiter
 * Prevents email spamming
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    message: "Too many password reset requests.",
  },
});

/**
 * Registration limiter
 * Prevents bot account farming
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Max 3 accounts created per IP per hour
  message: { 
    success: false, 
    message: "Too many accounts created from this IP. Try again later." 
  },
});

/**
 * Payment initiation limiter
 * Prevents payment abuse and price-calculation hammering
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 payment initiations per IP per hour
  message: {
    success: false,
    message: "Too many payment requests. Please try again later.",
  },
});

module.exports = {
  loginLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  paymentLimiter,
};