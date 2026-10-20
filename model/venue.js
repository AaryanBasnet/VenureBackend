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

// What kind of venue it is: the main way people browse. (The older "garden estate, intimate hall..." labels are
// now the type of each SPACE inside a venue, see model/space.js SPACE_TYPES.)
const VENUE_CATEGORIES = ["banquet-party-palace", "hotel-resort", "heritage-traditional"];

const NO_PACKAGE_SORT_KEY = 1e12;

const derivePriceFields = (packages = []) => {
  const prices = packages.map((p) => Number(p.pricePerPlate)).filter((n) => Number.isFinite(n));
  const min = prices.length ? Math.min(...prices) : null;
  return { minPricePerPlate: min, priceSortKey: min === null ? NO_PACKAGE_SORT_KEY : min };
};

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
      index: true, // Speeds up the /venues?category= filter and the per-type counts
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
    // Demo data (see services/demoScope.js): a demo admin only sees records with this flag
    isDemo: { type: Boolean, default: false },
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
    // ---- Denormalised read models (kept up to date by hooks; see scripts/backfill-venue-derived.js) ----
    // Cheapest package price per plate (null when the venue has no packages). Maintained on every save.
    minPricePerPlate: { type: Number, default: null },
    // Same value, but venues without packages get a huge number so they sort LAST in ascending order.
    priceSortKey: { type: Number, default: NO_PACKAGE_SORT_KEY, select: false },
    // Largest active space and number of active spaces (maintained by hooks in model/space.js).
    maxCapacity: { type: Number, default: 0 },
    // Kinds of space this venue has (from its active spaces), for the "space type" filter. Kept in step by model/space.js.
    spaceTypes: { type: [String], default: [] },
    spaceCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Derive the price fields whenever packages change (create, save)
VenueSchema.pre("validate", function derivePrice() {
  if (this.isNew || this.isModified("packages")) {
    Object.assign(this, derivePriceFields(this.packages));
  }
});

// Updates that bypass save() and touch packages must carry the derived fields too
VenueSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function derivePriceOnUpdate() {
  const update = this.getUpdate() || {};
  const packages = update.packages ?? update.$set?.packages;
  if (Array.isArray(packages)) {
    this.set(derivePriceFields(packages));
  }
});

// General search index
VenueSchema.index({ venueName: "text", "location.city": "text" });

// Any write to a venue can change a cached public answer (list, featured, counts, detail)
const dropPublicCache = () => require("../utils/publicCache").invalidate();
VenueSchema.post(["save", "findOneAndUpdate", "findOneAndDelete", "updateOne", "updateMany", "deleteMany", "insertMany"], dropPublicCache);
VenueSchema.post("deleteOne", { document: true, query: true }, dropPublicCache);

// Real query shapes (see docs/PERFORMANCE.md). Every public list filters status+isDeleted first.
VenueSchema.index({ status: 1, isDeleted: 1, createdAt: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, category: 1, createdAt: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, "location.city": 1, createdAt: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, totalReviews: -1, averageRating: -1, createdAt: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, averageRating: -1, totalReviews: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, priceSortKey: 1, createdAt: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, minPricePerPlate: -1, createdAt: -1 });
VenueSchema.index({ status: 1, isDeleted: 1, maxCapacity: 1 });
VenueSchema.index({ status: 1, isDeleted: 1, spaceTypes: 1, createdAt: -1 });
VenueSchema.index({ "packages.pricePerPlate": 1 });
VenueSchema.index({ isFeatured: 1, status: 1, isDeleted: 1, createdAt: -1 });
VenueSchema.index({ owner: 1, isDeleted: 1, createdAt: -1 });

module.exports = mongoose.models.Venue || mongoose.model("Venue", VenueSchema);
module.exports.VENUE_CATEGORIES = VENUE_CATEGORIES;
module.exports.derivePriceFields = derivePriceFields;
module.exports.NO_PACKAGE_SORT_KEY = NO_PACKAGE_SORT_KEY;