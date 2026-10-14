const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  { filename: String, url: String },
  { _id: false }
);

// Day-part shifts instead of arbitrary hour ranges — matches how Nepali event
// venues actually book (see services/shiftService.js for the resolved hours).
const SHIFT_NAMES = ["day", "night", "full_day"];

const shiftOverrideSchema = new mongoose.Schema(
  {
    shift: { type: String, enum: SHIFT_NAMES, required: true },
    startTime: { type: String, required: true }, // "HH:mm", 24h
    endTime: { type: String, required: true },
  },
  { _id: false }
);

const SpaceSchema = new mongoose.Schema(
  {
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    amenities: {
      type: [String],
      default: [],
    },
    spaceImages: {
      type: [imageSchema],
      default: [],
    },
    // Display-only estimate for search/listing cards — never authoritative.
    // The real price is always the owner-authored Quotation.lineItems for a specific inquiry.
    indicativePricePerHour: {
      type: Number,
      min: 0,
    },
    // Per-shift hour overrides; falls back to shiftService.SHIFT_DEFAULTS when absent.
    shiftOverrides: {
      type: [shiftOverrideSchema],
      default: [],
    },
    defaultDepositType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    defaultDepositValue: {
      type: Number,
      default: 20,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Set by scripts/migrate-spaces.js so the migration can be safely re-run.
    migratedFromVenue: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

SpaceSchema.index({ venue: 1, isActive: 1 });

module.exports = mongoose.models.Space || mongoose.model("Space", SpaceSchema);
module.exports.SHIFT_NAMES = SHIFT_NAMES;
