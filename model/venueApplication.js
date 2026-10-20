const mongoose = require("mongoose");

const { SPACE_TYPES } = require("./space");

// The same three kinds a Venue is filed under (model/venue.js VENUE_CATEGORIES)
const VENUE_TYPES = ["banquet-party-palace", "hotel-resort", "heritage-traditional"];
const APPLICATION_STATUSES = ["pending", "approved", "rejected"];

const photoSchema = new mongoose.Schema({ filename: String, url: String }, { _id: false });

// A private file (business paper). publicId only works with a signed link from the API.
const documentSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, select: false },
    originalName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const hallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Required for new applications by the validator; applications saved before it existed have none
    spaceType: { type: String, enum: SPACE_TYPES },
    capacity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const VenueApplicationSchema = new mongoose.Schema(
  {
    venueName: { type: String, required: true, trim: true, maxlength: 80 },
    venueType: { type: String, enum: VENUE_TYPES, required: true },
    about: { type: String, trim: true, maxlength: 500, default: "" },

    // The applicant. There is no account yet: it is created when the application is approved.
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    contactName: { type: String, required: true, trim: true, maxlength: 80 },

    location: {
      province: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      area: { type: String, required: true, trim: true, maxlength: 160 },
    },
    mapLink: { type: String, trim: true, maxlength: 500, default: "" },
    coordinates: {
      type: new mongoose.Schema({ lat: Number, lng: Number }, { _id: false }),
      default: undefined,
    },

    halls: {
      type: [hallSchema],
      validate: { validator: (h) => h.length >= 1 && h.length <= 6, message: "Add between 1 and 6 halls" },
    },
    photos: { type: [photoSchema], default: [] },

    registrationCert: { type: documentSchema, required: true },
    panCert: { type: documentSchema, required: true },
    panNumber: { type: String, required: true, trim: true },

    status: { type: String, enum: APPLICATION_STATUSES, default: "pending", index: true },
    // Demo data (see services/demoScope.js): a demo admin only sees records with this flag
    isDemo: { type: Boolean, default: false },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,

    // Filled in at approval
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue" },
    // The one-time link that lets the owner choose a password. Only a hash is stored.
    setupTokenHash: { type: String, select: false },
    setupTokenExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

// One open application per email address: a second one cannot be filed while the first is waiting.
VenueApplicationSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
VenueApplicationSchema.index({ status: 1, createdAt: -1 });
VenueApplicationSchema.index({ setupTokenHash: 1 }, { sparse: true });

module.exports =
  mongoose.models.VenueApplication || mongoose.model("VenueApplication", VenueApplicationSchema);
module.exports.VENUE_TYPES = VENUE_TYPES;
module.exports.APPLICATION_STATUSES = APPLICATION_STATUSES;
