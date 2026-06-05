const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const authService = require("../services/authService");

/* =========================================================================
   UTILITY: Cookie Configuration
   Enterprise standard: 7 days, HttpOnly (prevents XSS), 
   Secure (requires HTTPS in production), SameSite (prevents CSRF)
========================================================================= */
const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", 
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
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

  // 2. Lock the Refresh Token in an impenetrable cookie
  res.cookie("refreshToken", result.refreshToken, getCookieOptions());

  // 3. Send ONLY the short-lived Access Token in the JSON body
  res.status(200).json({
    success: true,
    accessToken: result.accessToken,
    user: result.user,
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
  const { newAccessToken, newRefreshToken } = await authService.refreshAccessToken(
    oldRefreshToken,
    userAgent,
    ip
  );

  // 2. Overwrite the old cookie with the brand-new Refresh Token
  res.cookie("refreshToken", newRefreshToken, getCookieOptions());

  // 3. Send the fresh Access Token to the client
  res.status(200).json({
    success: true,
    accessToken: newAccessToken,
  });
});

/* ================= LOGOUT ================= */

const logoutUser = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  // 1. Tell the DB to destroy this specific session token
  if (refreshToken) {
    await authService.logout(refreshToken);
  }

  // 2. Instruct the browser to instantly delete the cookie
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

module.exports = {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
};