const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    venueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
    },
  },
  { timestamps: true }
);

// Fast lookup when finding a specific chat between two people for a venue
chatSchema.index({ participants: 1, venueId: 1 });

module.exports = mongoose.models.Chat || mongoose.model("Chat", chatSchema);