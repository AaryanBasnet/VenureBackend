const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Must match exactly how you named your User model export
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true, // Ensures fast lookups and prevents duplicate token entries
    },
    isUsed: {
      type: Boolean,
      default: false, // Flipped to true the moment it is rotated
    },
    isRevoked: {
      type: Boolean,
      default: false, // Flipped to true on manual logout or admin ban
    },
    userAgent: {
      type: String,
      default: "Unknown", // Stores browser/device info (e.g., "Chrome on Windows 11")
    },
    ipAddress: {
      type: String,
      default: "Unknown", // Stores the IP where the login occurred
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { 
    timestamps: true 
  }
);

/* =========================================================================
   ENTERPRISE LAYER: Native MongoDB TTL Index
   This tells MongoDB to automatically delete the document the exact moment
   the current server clock matches the 'expiresAt' date. No cron jobs needed.
========================================================================= */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
module.exports = RefreshToken;