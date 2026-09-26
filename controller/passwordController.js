const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const User = require("../model/user");
const Notification = require("../model/notification");
const sendEmail = require("../utils/sendEmail");
const authService = require("../services/authService");
const logger = require("../utils/logger");

const MAX_RESET_CODE_ATTEMPTS = 5;
const INVALID_CODE_MESSAGE = "Invalid or expired reset code";

const hashCode = (code) => crypto.createHash("sha256").update(code).digest("hex");

/**
 * Checks a reset code for an email. Every wrong guess counts against the code, and the
 * code is destroyed after MAX_RESET_CODE_ATTEMPTS so it cannot be brute-forced.
 * Returns the user (with reset fields selected) when the code is valid.
 */
const checkResetCode = async (email, code) => {
  const user = await User.findOne({ email, isDeleted: { $ne: true } }).select(
    "+resetPasswordToken +resetPasswordExpire +resetPasswordAttempts"
  );

  const hasActiveCode =
    user?.resetPasswordToken && user.resetPasswordExpire && user.resetPasswordExpire.getTime() > Date.now();
  if (!hasActiveCode) throw new AppError(INVALID_CODE_MESSAGE, 400);

  const expected = Buffer.from(user.resetPasswordToken, "hex");
  const actual = Buffer.from(hashCode(code), "hex");
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    const attempts = (user.resetPasswordAttempts || 0) + 1;
    const update =
      attempts >= MAX_RESET_CODE_ATTEMPTS
        ? { $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 }, $set: { resetPasswordAttempts: 0 } }
        : { $set: { resetPasswordAttempts: attempts } };
    await User.updateOne({ _id: user._id }, update);
    throw new AppError(INVALID_CODE_MESSAGE, 400);
  }

  return user;
};

/* ========================
   VERIFY PASSWORD (e.g., before sensitive account changes)
======================== */
const verifyPassword = asyncHandler(async (req, res) => {
  // Always the logged-in user: never accept a user id from the client
  const user = await User.findById(req.user._id).select("+password");
  if (!user) throw new AppError("User not found", 404);

  const match = await bcrypt.compare(req.body.password, user.password);
  if (!match) throw new AppError("Incorrect password", 401);

  res.json({ success: true });
});

/* ========================
   FORGOT PASSWORD
======================== */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Same response whether or not the account exists, so emails can't be enumerated
  const genericResponse = {
    success: true,
    message: "If an account exists for that email, a reset code has been sent.",
  };

  const user = await User.findOne({ email, isDeleted: { $ne: true } });
  if (!user) return res.json(genericResponse);

  const resetCode = user.getResetPasswordCode();
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({
      to: user.email,
      subject: "Your Password Reset Code",
      html: `<p>Your password reset code is: <strong>${resetCode}</strong></p>
             <p>This code will expire in 15 minutes.</p>`,
    });
  } catch (err) {
    logger.error({ message: "Password reset email failed", userId: user._id.toString() });
    throw new AppError("Could not send the reset email. Please try again later.", 503);
  }

  res.json(genericResponse);
});

/* ========================
   VERIFY RESET CODE
======================== */
const verifyResetCode = asyncHandler(async (req, res) => {
  await checkResetCode(req.body.email, req.body.code);
  res.json({ success: true, message: "Code verified successfully" });
});

/* ========================
   RESET PASSWORD WITH CODE
======================== */
const resetPasswordWithCode = asyncHandler(async (req, res) => {
  const { email, code, password } = req.body;

  const user = await checkResetCode(email, code);

  user.password = await bcrypt.hash(password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.resetPasswordAttempts = 0;
  await user.save();

  // Anyone holding an old session is logged out once the password changes
  await authService.revokeAllSessions(user._id);

  const notification = await Notification.create({
    recipient: user._id,
    type: "security",
    message: "Your password was recently changed.",
  });

  const io = req.app.get("io");
  if (io) io.to(user._id.toString()).emit("newNotification", notification);

  res.json({ success: true, message: "Password reset successfully" });
});

module.exports = {
  verifyPassword,
  forgotPassword,
  verifyResetCode,
  resetPasswordWithCode,
};
