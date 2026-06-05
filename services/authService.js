const User = require("../model/user");
const RefreshToken = require("../model/RefreshToken"); // ✨ The new dedicated model
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

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
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );
};

// Helper to hash tokens before saving to DB
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

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
    role,
    password: hashed,
  });

  logger.info(`User registered: ${user._id}`);
  return user;
};

/* ================= LOGIN ================= */

const login = async (email, password, userAgent, ip) => {
  email = email.toLowerCase().trim();

  // ✨ Fix: Explicitly request the password field for validation
  const user = await User.findOne({ email }).select("+password");
  if (!user) throw new AppError("Invalid credentials", 401);

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AppError("Invalid credentials", 401);

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // ✨ Save session to the dedicated RefreshToken collection
  await RefreshToken.create({
    userId: user._id,
    token: hashToken(refreshToken),
    userAgent,
    ipAddress: ip,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  return {
    accessToken,
    refreshToken, // Sent to controller to put in HTTP-Only cookie
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

/* ================= REFRESH (TOKEN ROTATION) ================= */

const refreshAccessToken = async (token, userAgent, ip) => {
  if (!token) throw new AppError("No refresh token provided", 401);

  // 1. Verify the JWT signature
  const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
  
  // 2. Find the token in our database
  const hashedToken = hashToken(token);
  const savedToken = await RefreshToken.findOne({ token: hashedToken });

  // 🚨 BREACH DETECTION LOGIC
  if (!savedToken) {
    // The token signature is valid, but it's not in the DB. 
    // It was likely stolen, used, and rotated. Nuke all user sessions.
    logger.warn(`Security Alert: Replay attack detected for user ${decoded.id}`);
    await RefreshToken.deleteMany({ userId: decoded.id });
    throw new AppError("Security alert: Invalid session. Please log in again.", 403);
  }

  if (savedToken.isUsed || savedToken.isRevoked) {
    logger.warn(`Security Alert: Attempted use of revoked/used token for user ${decoded.id}`);
    await RefreshToken.deleteMany({ userId: decoded.id });
    throw new AppError("Security alert: Invalid session. Please log in again.", 403);
  }

  // 3. Token is valid. Get user.
  const user = await User.findById(decoded.id);
  if (!user) throw new AppError("User not found", 404);

  // 4. Mark old token as used (Rotation)
  savedToken.isUsed = true;
  await savedToken.save();

  // 5. Issue brand new token pair
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  // 6. Save new refresh token to DB
  await RefreshToken.create({
    userId: user._id,
    token: hashToken(newRefreshToken),
    userAgent,
    ipAddress: ip,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return { newAccessToken, newRefreshToken };
};

/* ================= LOGOUT ================= */

const logout = async (token) => {
  if (!token) return;
  const hashedToken = hashToken(token);
  
  // Delete the token so it can never be used again
  await RefreshToken.findOneAndDelete({ token: hashedToken });
};

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
};