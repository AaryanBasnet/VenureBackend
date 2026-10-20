const mongoose = require("mongoose");
const { SHIFT_NAMES } = require("./space");

const lineItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    description: String,
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    perGuest: { type: Boolean, default: false }, // e.g. per-plate catering
    // Snapshotted at creation time: quantity * unitPrice * (perGuest ? guests : 1)
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const QuotationSchema = new mongoose.Schema(
  {
    inquiry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inquiry",
      required: true,
      index: true,
    },
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
    },
    // The owner always confirms a specific space when quoting, even if the
    // Inquiry itself didn't specify one.
    space: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Space",
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    eventDate: {
      type: Date,
      required: true,
    },
    shift: {
      type: String,
      enum: SHIFT_NAMES,
      required: true,
    },
    // Server-resolved from {eventDate, shift, space} via shiftService.resolveShiftTimes.
    // Kept as real Dates so the existing overlap-check logic needs no changes.
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
      min: 1,
    },
    lineItems: {
      type: [lineItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "A quotation needs at least one line item",
      },
    },
    totalPrice: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "NPR",
    },
    depositType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    depositValue: {
      type: Number,
      required: true,
    },
    // Server-computed snapshots (never trusted from the client) — see
    // services/quotationService.js computeDepositAmount.
    depositAmount: {
      type: Number,
      required: true,
    },
    balanceAmount: {
      type: Number,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["sent", "accepted", "rejected", "expired", "superseded", "withdrawn"],
      default: "sent",
      index: true,
    },
    notes: {
      type: String,
      maxlength: 1000,
    },
    respondedAt: Date,
  },
  { timestamps: true }
);

QuotationSchema.index({ inquiry: 1, status: 1 });
QuotationSchema.index({ owner: 1 });
QuotationSchema.index({ owner: 1, createdAt: -1 });
QuotationSchema.index({ inquiry: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.Quotation || mongoose.model("Quotation", QuotationSchema);
