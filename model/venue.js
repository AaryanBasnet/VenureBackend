const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  { filename: String, url: String },
  { _id: false }
);

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
    capacity: {
      type: Number,
      min: 1,
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
    pricePerHour: {
      type: Number,
      min: 0,
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
  },
  { timestamps: true }
);

// General search index
VenueSchema.index({ venueName: "text", "location.city": "text" });

module.exports = mongoose.models.Venue || mongoose.model("Venue", VenueSchema);