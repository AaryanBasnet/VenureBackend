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
      type: Object, // Optional metadata
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);
