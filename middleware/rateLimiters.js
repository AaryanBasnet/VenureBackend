const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const limitMessage = (message) => ({ success: false, message });

/**
 * Login rate limiter
 * Prevents brute-force credential stuffing
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // attempts per IP
  skipSuccessfulRequests: true, // only failed logins count
  message: limitMessage("Too many login attempts. Try again later."),
});

/**
 * Forgot password limiter
 * Prevents email spamming
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: limitMessage("Too many password reset requests."),
});

/**
 * Reset code limiter (verify-code + reset-password)
 * Keyed by IP *and* email so one attacker can't spread guesses across accounts,
 * and one account can't be attacked from many requests in a row.
 */
const resetCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").toLowerCase()}`,
  message: limitMessage("Too many attempts. Please request a new code later."),
});

/**
 * Current-password check limiter (per logged-in user)
 */
const verifyPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.user ? `user:${req.user._id}` : ipKeyGenerator(req.ip)),
  message: limitMessage("Too many password attempts. Try again later."),
});

/**
 * Registration limiter
 * Prevents bot account farming
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: limitMessage("Too many accounts created from this IP. Try again later."),
});

/**
 * Payment initiation limiter
 * Prevents payment abuse and price-calculation hammering
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: limitMessage("Too many payment requests. Please try again later."),
});

/**
 * Public contact form limiter
 */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: limitMessage("Too many messages sent. Please try again later."),
});

/**
 * Public newsletter signup limiter
 */
const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: limitMessage("Too many attempts. Please try again later."),
});

module.exports = {
  loginLimiter,
  forgotPasswordLimiter,
  resetCodeLimiter,
  verifyPasswordLimiter,
  registerLimiter,
  paymentLimiter,
  contactLimiter,
  newsletterLimiter,
};
