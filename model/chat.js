const mongoose = require("mongoose");

const lastMessageSchema = new mongoose.Schema({ text: String, timestamp: Date }, { _id: false });

const chatSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    venueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
    },
    // Denormalised preview of the newest message, so the conversation list needs no message aggregation
    lastMessage: { type: lastMessageSchema, default: undefined },
  },
  { timestamps: true }
);

// Fast lookup when finding a specific chat between two people for a venue
chatSchema.index({ participants: 1, venueId: 1 });
chatSchema.index({ participants: 1, updatedAt: -1 }); // conversation list

module.exports = mongoose.models.Chat || mongoose.model("Chat", chatSchema);