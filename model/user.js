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
    required: true,
    select: false, // ENTERPRISE LAYER: Never return the password hash by default in queries
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
  resetPasswordToken: String,
  resetPasswordExpire: Date,
});

/* =========================================================================
   SECURITY LAYER: Fixes raw token leak risk in the reset code helper
========================================================================= */
userSchema.methods.getResetPasswordCode = function () {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
  
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");
    
  this.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes expiry
  
  return code; 
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);