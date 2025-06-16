const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    filename: String,
    url: String, // local path or cloud URL
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
      address: { type: String },
      city: { type: String },
      state: { type: String },
      country: { type: String },
    //   coordinates: {
    //     lat: { type: Number },
    //     lng: { type: Number },
    //   },
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
      type: [String], // e.g. ['WiFi', 'Parking', 'AC']
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Venue", VenueSchema);
