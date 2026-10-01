const User = require("../model/user");
const RefreshToken = require("../model/refreshToken");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

// A second refresh with the same token inside this window is treated as a
// concurrent refresh (e.g. two tabs), not as a stolen-token replay.
const REFRESH_REUSE_GRACE_MS = 30 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOCKET_TOKEN_AUDIENCE = "socket";

/* ================= TOKEN UTILS ================= */

const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id, jti: crypto.randomUUID() },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
};

// Short-lived token the browser passes in the Socket.io handshake. Needed because the
// socket connects cross-site, where the HTTP-only cookie may not be sent.
const generateSocketToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "60s",
    audience: SOCKET_TOKEN_AUDIENCE,
  });
};

const verifySocketToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, { audience: SOCKET_TOKEN_AUDIENCE });

// Helper to hash tokens before saving to DB
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const findActiveUser = (query) => User.findOne({ ...query, isDeleted: { $ne: true } });

const revokeAllSessions = (userId) => RefreshToken.deleteMany({ userId });

/* ================= REGISTER ================= */

const register = async ({ name, email, phone, role, password }) => {
  email = email.toLowerCase().trim();

  const exists = await User.findOne({ email });
  if (exists) throw new AppError("User already exists", 409);

  const hashed = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    email,
    phone,
    // Defence in depth: the validator already restricts this, never allow Admin here
    role: role === "VenueOwner" ? "VenueOwner" : "Customer",
    password: hashed,
  });

  logger.info(`User registered: ${user._id}`);
  return user;
};

/* ================= SESSION ISSUING (shared by password + Google login) ================= */

const issueSession = async (user, userAgent, ip) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await RefreshToken.create({
    userId: user._id,
    token: hashToken(refreshToken),
    userAgent,
    ipAddress: ip,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return {
    accessToken,
    refreshToken, // Sent to controller to put in HTTP-Only cookie
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      avatar: user.avatar,
    },
  };
};

/* ================= LOGIN ================= */

const login = async (email, password, userAgent, ip) => {
  email = email.toLowerCase().trim();

  const user = await findActiveUser({ email }).select("+password");
  if (!user) throw new AppError("Invalid credentials", 401);
  if (!user.password) {
    // Registered via Google; there is no password to check against
    throw new AppError("This account signs in with Google. Use “Continue with Google” instead.", 401);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AppError("Invalid credentials", 401);

  return issueSession(user, userAgent, ip);
};

/* ================= GOOGLE SIGN-IN ================= */
// One endpoint for both login and first-time registration: an unrecognised
// Google account is created on the spot, same as clicking "Register" would.
const loginWithGoogle = async (idToken, userAgent, ip) => {
  if (!googleClient) {
    throw new AppError("Google sign-in is not configured on this server", 501);
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn({ message: "Google ID token verification failed", error: err.message });
    throw new AppError("We could not verify that Google sign-in. Please try again.", 401);
  }

  if (!payload.email_verified) {
    throw new AppError("Your Google email is not verified", 401);
  }

  const email = payload.email.toLowerCase().trim();

  let user = await findActiveUser({ googleId: payload.sub });
  if (!user) {
    // Same email, no Google link yet: attach this Google account to it
    user = await findActiveUser({ email });
    if (user) {
      user.googleId = payload.sub;
      if (!user.avatar && payload.picture) user.avatar = payload.picture;
      await user.save();
    }
  }

  if (!user) {
    user = await User.create({
      name: payload.name || email.split("@")[0],
      email,
      googleId: payload.sub,
      avatar: payload.picture || "",
      role: "Customer",
    });
    logger.info(`User registered via Google: ${user._id}`);
  }

  return issueSession(user, userAgent, ip);
};

/* ================= REFRESH (TOKEN ROTATION) ================= */

const refreshAccessToken = async (token, userAgent, ip) => {
  if (!token) throw new AppError("No refresh token provided", 401);

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  const savedToken = await RefreshToken.findOne({ token: hashToken(token) });

  if (!savedToken) {
    // Valid signature but unknown token: it was already rotated long ago or revoked.
    logger.warn({ message: "Refresh token replay detected", userId: decoded.id });
    await revokeAllSessions(decoded.id);
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  if (savedToken.isRevoked) {
    await revokeAllSessions(decoded.id);
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  if (savedToken.isUsed) {
    const usedAgoMs = Date.now() - savedToken.updatedAt.getTime();
    if (usedAgoMs <= REFRESH_REUSE_GRACE_MS) {
      // Another tab refreshed a moment ago; its new cookies are already in the browser.
      throw new AppError("Session was just refreshed", 409);
    }
    logger.warn({ message: "Reuse of rotated refresh token", userId: decoded.id });
    await revokeAllSessions(decoded.id);
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  const user = await findActiveUser({ _id: decoded.id });
  if (!user) {
    await revokeAllSessions(decoded.id);
    throw new AppError("Invalid session. Please log in again.", 401);
  }

  // Atomically claim the token so two simultaneous requests can't both rotate it
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: savedToken._id, isUsed: false },
    { isUsed: true },
    { new: true }
  );
  if (!claimed) throw new AppError("Session was just refreshed", 409);

  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  await RefreshToken.create({
    userId: user._id,
    token: hashToken(newRefreshToken),
    userAgent,
    ipAddress: ip,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return { newAccessToken, newRefreshToken };
};

/* ================= LOGOUT ================= */

const logout = async (token) => {
  if (!token) return;
  await RefreshToken.findOneAndDelete({ token: hashToken(token) });
};

module.exports = {
  register,
  issueSession,
  login,
  loginWithGoogle,
  refreshAccessToken,
  logout,
  revokeAllSessions,
  generateSocketToken,
  verifySocketToken,
};
