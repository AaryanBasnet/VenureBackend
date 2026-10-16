const mongoose = require("mongoose");

// Editorial copy for the public home page. One singleton document keyed "home".
// Images are NOT stored here: the frontend maps each `imageKey` to its own bundled asset.
const landingContentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.models.LandingContent || mongoose.model("LandingContent", landingContentSchema);
