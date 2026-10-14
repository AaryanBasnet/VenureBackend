const mongoose = require("mongoose");
const { SHIFT_NAMES } = require("./space");

const InquirySchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
      index: true,
    },
    // Optional — the customer may leave this blank and let the owner recommend a space.
    space: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Space",
      default: null,
    },
    preferredDate: {
      type: Date,
      required: true,
    },
    // Optional — the customer may be flexible on shift.
    preferredShift: {
      type: String,
      enum: SHIFT_NAMES,
      default: null,
    },
    numberOfGuests: {
      type: Number,
      required: true,
      min: 1,
    },
    eventType: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      maxlength: 1000,
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
    status: {
      type: String,
      enum: ["pending", "quoted", "accepted", "declined", "cancelled", "expired"],
      default: "pending",
      index: true,
    },
    // The latest/active Quotation sent against this inquiry, if any.
    currentQuotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quotation",
      default: null,
    },
    // Set once the customer accepts a quotation and the deposit is confirmed.
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },
    respondedAt: Date,
  },
  { timestamps: true }
);

InquirySchema.index({ venue: 1, status: 1 });

module.exports = mongoose.models.Inquiry || mongoose.model("Inquiry", InquirySchema);
