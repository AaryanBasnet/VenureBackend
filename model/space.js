const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  { filename: String, url: String },
  { _id: false }
);

// Day-part shifts instead of arbitrary hour ranges — matches how Nepali event
// venues actually book (see services/shiftService.js for the resolved hours).
const SHIFT_NAMES = ["day", "night", "full_day"];

// What kind of space a hall is. A venue (hotel, banquet hall, heritage house) can hold several kinds.
const SPACE_TYPES = ["heritage-courtyards", "garden-estates", "intimate-halls", "mountain-retreats", "rooftop-terraces"];

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
    spaceType: {
      type: String,
      enum: SPACE_TYPES,
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
SpaceSchema.index({ venue: 1, isActive: 1, capacity: -1 });

// Keep Venue.maxCapacity / spaceCount / spaceTypes (largest active space, active space count, kinds of space) in step with
// space writes, so public lists need no per-request aggregation. Recomputed from the truth every
// time, so concurrent writes converge on the right value.
const syncVenueCapacity = async (venueRef) => {
  if (!venueRef) return;
  // doc.venue is a whole Venue document when the space was loaded with populate("venue"): aggregation does not cast it
  const venueId = venueRef._id ?? venueRef;
  const Venue = mongoose.model("Venue");
  const [row] = await mongoose.model("Space").aggregate([
    { $match: { venue: venueId, isActive: true } },
    { $group: { _id: null, maxCapacity: { $max: "$capacity" }, spaceCount: { $sum: 1 }, spaceTypes: { $addToSet: "$spaceType" } } },
  ]);
  await Venue.updateOne(
    { _id: venueId },
    { $set: { maxCapacity: row?.maxCapacity ?? 0, spaceCount: row?.spaceCount ?? 0, spaceTypes: (row?.spaceTypes ?? []).filter(Boolean).sort() } },
    { timestamps: false }
  );
};

SpaceSchema.post("save", (doc) => syncVenueCapacity(doc.venue));
SpaceSchema.post("findOneAndUpdate", (doc) => (doc ? syncVenueCapacity(doc.venue) : undefined));
SpaceSchema.post("findOneAndDelete", (doc) => (doc ? syncVenueCapacity(doc.venue) : undefined));
SpaceSchema.post("deleteOne", { document: true, query: false }, (doc) => syncVenueCapacity(doc.venue));

module.exports = mongoose.models.Space || mongoose.model("Space", SpaceSchema);
module.exports.SHIFT_NAMES = SHIFT_NAMES;
module.exports.SPACE_TYPES = SPACE_TYPES;
module.exports.syncVenueCapacity = syncVenueCapacity;
