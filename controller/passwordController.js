const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const User = require("../model/user");
const Notification = require("../model/notification");
const sendEmail = require("../utils/sendEmail");

/* ========================
   VERIFY PASSWORD (e.g., before sensitive account changes)
======================== */
const verifyPassword = asyncHandler(async (req, res) => {
  const { userId, password } = req.body;

  // ⚠️ CRITICAL FIX: Must explicitly request the password field here
  const user = await User.findById(userId).select("+password");

  if (!user) throw new AppError("User not found", 404);

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new AppError("Incorrect password", 401);

  res.json({ success: true });
});

/* ========================
   FORGOT PASSWORD
======================== */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) throw new AppError("User not found", 404);

  const resetCode = user.getResetPasswordCode();
  await user.save({ validateBeforeSave: false });

  await sendEmail({
    to: user.email,
    subject: "Your Password Reset Code",
    html: `<p>Your password reset code is: <strong>${resetCode}</strong></p>
           <p>This code will expire in 15 minutes.</p>`,
  });

  res.json({ success: true, message: "Reset code sent to email" });
});

/* ========================
   VERIFY RESET CODE
======================== */
const verifyResetCode = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  const hashed = crypto.createHash("sha256").update(code).digest("hex");

  const user = await User.findOne({
    email,
    resetPasswordToken: hashed,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) throw new AppError("Invalid or expired reset code", 400);

  res.json({ success: true, message: "Code verified successfully" });
});

/* ========================
   RESET PASSWORD WITH CODE
======================== */
const resetPasswordWithCode = asyncHandler(async (req, res) => {
  const { email, code, password } = req.body;

  const hashed = crypto.createHash("sha256").update(code).digest("hex");

  const user = await User.findOne({
    email,
    resetPasswordToken: hashed,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) throw new AppError("Invalid or expired reset code", 400);

  user.password = await bcrypt.hash(password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;

  await user.save();

  // Push real-time notification
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