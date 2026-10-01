const mongoose = require("mongoose");
const crypto = require("crypto");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    // Google-only accounts never set a password
    required: function () {
      return !this.googleId;
    },
    select: false, // ENTERPRISE LAYER: Never return the password hash by default in queries
  },
  googleId: {
    type: String,
    sparse: true, // Lets every password-only account omit this without violating uniqueness
    unique: true,
  },
  role: {
    type: String,
    enum: ["Customer", "VenueOwner", "Admin"],
    default: "Customer",
  },
  phone: {
    type: String,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
  },
  avatar: {
    type: String,
    default: "",
  },
  // Add this inside your userSchema definition:
  isDeleted: {
    type: Boolean,
    default: false,
    select: false, // Hides this field from standard frontend queries
  },
  favorites: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpire: { type: Date, select: false },
  // Failed attempts against the current reset code; the code is burned after too many
  resetPasswordAttempts: { type: Number, default: 0, select: false },
});

/* =========================================================================
   SECURITY LAYER: Fixes raw token leak risk in the reset code helper
========================================================================= */
userSchema.methods.getResetPasswordCode = function () {
  const code = crypto.randomInt(100000, 1000000).toString(); // 6-digit code, CSPRNG
  
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");
    
  this.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes expiry
  this.resetPasswordAttempts = 0;
  
  return code; 
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);