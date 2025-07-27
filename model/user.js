const mongoose = require("mongoose");
const crypto = require("crypto");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true, // removes white space
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
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
    type: String, // image URL or relative path like /uploads/users/filename.jpg
    default: "", // or a placeholder image URL
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

userSchema.methods.getResetPasswordCode = function () {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex"); // hash
  this.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes expiry
  return code; // return plain code to send via email
};

const User = mongoose.model("User", userSchema);
module.exports = User;
