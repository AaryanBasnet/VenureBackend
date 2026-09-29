const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const authService = require("../services/authService");

/* =========================================================================
   UTILITY: Cookie Configuration
   Enterprise standard: 7 days, HttpOnly (prevents XSS), 
   Secure (requires HTTPS in production), SameSite (prevents CSRF)
========================================================================= */
const isProduction = process.env.NODE_ENV === "production";

// Cross-site (Vercel → Render) requires SameSite=None + Secure.
// Locally (same origin) Lax is fine and doesn't need HTTPS.
const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

const getAccessCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 15 * 60 * 1000, // 15 minutes
});

/* =========================================================================
   UTILITY: Fingerprint Extractor
========================================================================= */
const getFingerprint = (req) => {
  return {
    userAgent: req.headers["user-agent"] || "Unknown Device",
    ip: req.ip || req.connection.remoteAddress || "Unknown IP",
  };
};

const clearAuthCookies = (res) => {
  const clearOpts = { httpOnly: true, secure: isProduction, sameSite: isProduction ? "none" : "lax" };
  res.clearCookie("accessToken", clearOpts);
  res.clearCookie("refreshToken", clearOpts);
};

/* ================= REGISTER ================= */

const registerUser = asyncHandler(async (req, res) => {
  // Registration usually just creates the account. 
  // We force them to log in afterward to establish the secure session.
  await authService.register(req.body);

  res.status(201).json({
    success: true,
    message: "User registered successfully. Please log in.",
  });
});

/* ================= LOGIN ================= */

const loginUser = asyncHandler(async (req, res) => {
  const { userAgent, ip } = getFingerprint(req);

  // 1. Pass credentials AND fingerprint down to the service
  const result = await authService.login(
    req.body.email,
    req.body.password,
    userAgent,
    ip
  );

  // 2. Set both tokens as HTTP-Only cookies — client never touches them directly
  res.cookie("accessToken", result.accessToken, getAccessCookieOptions());
  res.cookie("refreshToken", result.refreshToken, getRefreshCookieOptions());

  // 3. Return the user object in the standard envelope
  res.status(200).json({
    success: true,
    data: result.user,
  });
});

/* ================= GOOGLE SIGN-IN ================= */

const googleAuth = asyncHandler(async (req, res) => {
  const { userAgent, ip } = getFingerprint(req);

  const result = await authService.loginWithGoogle(req.body.credential, userAgent, ip);

  res.cookie("accessToken", result.accessToken, getAccessCookieOptions());
  res.cookie("refreshToken", result.refreshToken, getRefreshCookieOptions());

  res.status(200).json({
    success: true,
    data: result.user,
  });
});

/* ================= REFRESH (TOKEN ROTATION) ================= */

const refreshToken = asyncHandler(async (req, res) => {
  const oldRefreshToken = req.cookies.refreshToken;
  const { userAgent, ip } = getFingerprint(req);

  if (!oldRefreshToken) {
    throw new AppError("Authentication required. Please log in.", 401);
  }

  // 1. Execute the rotation and get the brand-new pair
  let tokens;
  try {
    tokens = await authService.refreshAccessToken(oldRefreshToken, userAgent, ip);
  } catch (err) {
    // A dead session shouldn't leave stale cookies; a 409 (concurrent refresh) keeps them
    if (err.statusCode === 401) clearAuthCookies(res);
    throw err;
  }
  const { newAccessToken, newRefreshToken } = tokens;

  // 2. Rotate both cookies with fresh tokens
  res.cookie("accessToken", newAccessToken, getAccessCookieOptions());
  res.cookie("refreshToken", newRefreshToken, getRefreshCookieOptions());

  res.status(200).json({ success: true });
});

/* ================= LOGOUT ================= */

const logoutUser = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  // 1. Tell the DB to destroy this specific session token
  if (refreshToken) {
    await authService.logout(refreshToken);
  }

  // 2. Instruct the browser to instantly delete both cookies
  clearAuthCookies(res);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

/* ================= GET ME ================= */

const getMe = asyncHandler(async (req, res) => {
  // req.user is populated by protectRoute
  res.status(200).json({
    success: true,
    data: req.user,
  });
});

/* ================= SOCKET TOKEN ================= */

// Short-lived token for the Socket.io handshake (see authService.generateSocketToken)
const getSocketToken = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: { token: authService.generateSocketToken(req.user) },
  });
});

module.exports = {
  getSocketToken,
  registerUser,
  loginUser,
  googleAuth,
  refreshToken,
  logoutUser,
  getMe,
};