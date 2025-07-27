const User = require("../model/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ActivityLog = require("../model/activityLog");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
const Notification = require("../model/notification"); 

const registerUser = async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;

    if (!name || !email || !password || !phone) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "User Already exists" });
    }

    const hasedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hasedPassword,
      role,
      phone,
    });

    await newUser.save();

    // ✅ Add activity log
    await ActivityLog.create({
      message: `New user registration: ${newUser.name}`,
      icon: "UserPlusIcon",
      color: "text-green-600",
      type: "registration",
    });

    res.status(201).json({
      success: true,
      message: "User registered succesfully",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Please enter all the fields",
    });
  }
  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User Doesnt exist",
      });
    }

    const isPasswordMatching = await bcrypt.compare(password, user.password);
    if (!isPasswordMatching) {
      return res.status(404).json({
        success: false,
        message: "Invalid Credential",
      });
    }

    const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });
    res.status(200).json({
      success: true,
      message: "User logged in successfully.",
      token,
      userData: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const verifyPassword = async (req, res) => {
  const { userId, password } = req.body;

  if (!userId || !password) {
    return res.status(400).json({
      success: false,
      message: "User ID and password are required",
    });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    res.status(200).json({ success: true, message: "Password verified" });
  } catch (err) {
    console.error("Password verification error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    console.log(
      "[ForgotPassword] User lookup:",
      user ? user.email : "Not found"
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const resetCode = user.getResetPasswordCode();
    await user.save({ validateBeforeSave: false });

    console.log("[ForgotPassword] Generated reset code (plain):", resetCode);
    console.log(
      "[ForgotPassword] Stored resetPasswordToken (hashed):",
      user.resetPasswordToken
    );
    console.log(
      "[ForgotPassword] Code expiry timestamp:",
      user.resetPasswordExpire
    );
    console.log("[ForgotPassword] Current time:", Date.now());

    const message = `
      <h2>Venure Password Reset Code</h2>
      <p>Your password reset code is: <strong>${resetCode}</strong></p>
      <p>This code will expire in 15 minutes.</p>
    `;

    await sendEmail({
      to: user.email,
      subject: "Venure Password Reset Code",
      html: message,
    });

    res
      .status(200)
      .json({ success: true, message: "Reset code sent to your email" });
  } catch (err) {
    console.error("[ForgotPassword] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /auth/verify-reset-code
const verifyResetCode = async (req, res) => {
  const { email, code } = req.body;
  const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

  console.log("[VerifyResetCode] Email:", email);
  console.log("[VerifyResetCode] Plain code from user:", code);
  console.log("[VerifyResetCode] Hashed code:", hashedCode);
  console.log("[VerifyResetCode] Current time:", Date.now());

  try {
    const user = await User.findOne({
      email,
      resetPasswordToken: hashedCode,
      resetPasswordExpire: { $gt: Date.now() },
    });

    console.log("[VerifyResetCode] User found:", !!user);
    if (user) {
      console.log(
        "[VerifyResetCode] Stored resetPasswordCodeExpire:",
        user.resetPasswordExpire
      );
      console.log(
        "[VerifyResetCode] Time difference (expire - now):",
        user.resetPasswordExpire - Date.now()
      );
    }

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired code" });
    }

    res.status(200).json({ success: true, message: "Code verified" });
  } catch (err) {
    console.error("[VerifyResetCode] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /auth/reset-password
const resetPasswordWithCode = async (req, res) => {
  const { email, code, password } = req.body;
  const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

  console.log("[ResetPassword] Email:", email);
  console.log("[ResetPassword] Plain code:", code);
  console.log("[ResetPassword] Hashed code:", hashedCode);
  console.log("[ResetPassword] Current time:", Date.now());

  try {
    const user = await User.findOne({
      email,
      resetPasswordToken: hashedCode,
      resetPasswordExpire: { $gt: Date.now() },
    });

    console.log("[ResetPassword] User found:", !!user);
    if (user) {
      console.log(
        "[ResetPassword] Stored resetPasswordCodeExpire:",
        user.resetPasswordExpire
      );
      console.log(
        "[ResetPassword] Time difference (expire - now):",
        user.resetPasswordExpire - Date.now()
      );
    }

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired code" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    // 🔔 Create notification after successful reset
    const notification = await Notification.create({
      recipient: user._id,
      type: "security",
      message: "Your password has been reset successfully.",
      link: "/profile/security", // adjust link as needed
    });

    // 🔔 Emit via socket.io if enabled
    const io = req.app.get("io");
    if (io) {
      io.to(user._id.toString()).emit("newNotification", notification);
    }

    console.log(
      "[ResetPassword] Password reset successful for user:",
      user.email
    );

    res
      .status(200)
      .json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("[ResetPassword] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  registerUser,
  loginUser,
  verifyPassword,
  forgotPassword,
  resetPasswordWithCode,
  verifyResetCode,
};
