const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  { filename: String, url: String },
  { _id: false }
);

// Nepali venues price per plate, by food package (not per hour). The final price still
// comes from the owner's Quotation; these are what the customer sees and can prefer.
const packageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  tagline: { type: String, trim: true, maxlength: 80, default: "" },
  pricePerPlate: { type: Number, required: true, min: 0 },
  minPlates: { type: Number, min: 1, default: 1 },
  highlights: { type: [{ type: String, trim: true, maxlength: 140 }], default: [] },
});

const drinkOptionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, trim: true, maxlength: 140, default: "" },
  items: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
});

const maxItems = (max) => ({
  validator: (list) => list.length <= max,
  message: `At most ${max} entries allowed`,
});

// Matches the venue-type slugs on the public landing page (src/features/landing/content/landingContent.js)
const VENUE_CATEGORIES = [
  "heritage-courtyards",
  "garden-estates",
  "intimate-halls",
  "mountain-retreats",
  "rooftop-terraces",
];

const VenueSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    venueName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: VENUE_CATEGORIES,
      index: true, // Speeds up the landing page's per-category counts and /venues?category= filter
    },
    //  Standardized address + GeoJSON for map queries
    location: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
    },
    geoCoordinates: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], index: "2dsphere" }, // [longitude, latitude]
    },
    venueImages: {
      type: [imageSchema],
      default: [],
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    amenities: {
      type: [String],
      default: [],
    },
    packages: {
      type: [packageSchema],
      default: [],
      validate: maxItems(6),
    },
    drinkOptions: {
      type: [drinkOptionSchema],
      default: [],
      validate: maxItems(6),
    },
    // Public business contact for call / WhatsApp buttons (not the owner's account phone).
    contactPhone: {
      type: String,
      trim: true,
      maxlength: 20,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true, // Speeds up filtering for approved venues
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    //  Replaced embedded array with lightweight summary stats
    averageRating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0, // Default should be 0, not 1
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true, // Speeds up the query for the landing page's featured venues
    },
  },
  { timestamps: true }
);

// General search index
VenueSchema.index({ venueName: "text", "location.city": "text" });

module.exports = mongoose.models.Venue || mongoose.model("Venue", VenueSchema);
module.exports.VENUE_CATEGORIES = VENUE_CATEGORIES;