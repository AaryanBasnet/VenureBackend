const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["user", "booking", "venue", "payment", "system", "registration"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed, // Allows arbitrary object data
    },
    isDemo: { type: Boolean, default: false }, // see services/demoScope.js
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Enterprise Optimization: Index for fast Admin dashboard sorting
activityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.ActivityLog || mongoose.model("ActivityLog", activityLogSchema);