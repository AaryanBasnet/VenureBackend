const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      maxlength: 100,
      default: "",
    },
    comment: {
      type: String,
      maxlength: 1000,
      required: true,
    },
    helpfulCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);
const imageSchema = new mongoose.Schema(
  {
    filename: String,
    url: String,
  },
  { _id: false }
);

const VenueSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    venueName: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
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
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    reviews: {
      type: [reviewSchema],
      default: [],
    },

    averageRating: {
      type: Number,
      min: 1,
      max: 5,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Venue", VenueSchema);
