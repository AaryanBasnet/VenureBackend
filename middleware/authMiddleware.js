const jwt = require("jsonwebtoken");
const User = require("../model/user");
const AppError = require("../utils/AppError");

/* ========================
   PROTECT ROUTE (JWT CHECK)
======================== */
const protectRoute = async (req, res, next) => {
  try {
    // Read the short-lived access token from the HTTP-Only cookie
    const token = req.cookies.accessToken;

    if (!token) {
      return next(new AppError("Not authorized, token missing", 401));
    }

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Get user from DB (security check, excluding password)
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return next(new AppError("User no longer exists", 401));
    }

    // 4. Attach user to request
    req.user = user;

    next();
  } catch (err) {
    // 🚨 Enterprise Fix: Tell the frontend EXACTLY why it failed so it can silently refresh
    if (err.name === "TokenExpiredError") {
      return next(new AppError("Token expired", 401)); 
    }
    return next(new AppError("Not authorized, invalid token", 401));
  }
};

/* ========================
   ROLE BASED ACCESS CONTROL
======================== */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError("User not authenticated", 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Role (${req.user.role}) is not allowed to access this route`,
          403
        )
      );
    }

    next();
  };
};

module.exports = {
  protectRoute,
  authorizeRoles,
};