const mongoose = require("mongoose");
const { SHIFT_NAMES } = require("./space");

const cancellationTierSchema = new mongoose.Schema(
  { minDaysBefore: Number, refundPercentage: Number },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    // Null only for bookings migrated from before the Inquiry/Quotation flow existed.
    inquiry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inquiry",
      default: null,
    },
    quotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quotation",
      default: null,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Kept denormalized alongside `space` so the owner/admin dashboards that
    // resolve "this owner's bookings" via Venue.find({owner}) need no restructuring.
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
    },
    space: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Space",
      required: true,
    },
    // Customer/owner-facing representation, snapshotted from the quotation.
    eventDate: Date,
    shift: {
      type: String,
      enum: SHIFT_NAMES,
      default: null, // null only for legacy bookings that predate the shift model
    },
    //  Strict Datetime tracking prevents race conditions — still what the
    // overlap-conflict query actually uses, resolved from {eventDate, shift, space}.
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    numberOfGuests: {
      type: Number,
      required: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    specialRequirements: {
      type: String,
      default: "",
    },
    contactName: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    totalPrice: {
      type: Number,
      required: true,
    },
    depositAmount: {
      type: Number,
      required: true,
    },
    balanceAmount: {
      type: Number,
      required: true,
    },
    // The balance is settled outside the app (cash/bank transfer); the owner
    // just records that it happened. Venure never processes this payment.
    balanceSettled: {
      type: Boolean,
      default: false,
    },
    balanceSettledAt: Date,
    balanceSettledMethod: String, // free text, e.g. "cash", "bank transfer"
    balanceSettledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Snapshotted tiered refund schedule (services/bookingService.js CANCELLATION_REFUND_TIERS)
    // at the moment the deposit was paid — keeps cancellation terms auditable
    // even if the platform-wide policy changes later.
    cancellationPolicy: {
      type: [cancellationTierSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending_deposit", "confirmed", "cancelled", "completed"],
      default: "pending_deposit",
    },
    // Set only while a slot is being claimed. MongoDB's TTL monitor deletes the
    // document if the server dies mid-claim, so a crash can't block a slot forever.
    holdClaimExpiresAt: Date,
  },
  { timestamps: true }
);

/* =========================================================================
   ENTERPRISE LAYER: Collision Index
   Speeds up the query when checking if a space is already booked
========================================================================= */
bookingSchema.index({ space: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ venue: 1 }); // kept for owner/admin aggregations
bookingSchema.index({ customer: 1 }); // Fast lookup for user dashboards
bookingSchema.index({ holdClaimExpiresAt: 1 }, { expireAfterSeconds: 0 }); // Only affects documents that have the field

module.exports = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
