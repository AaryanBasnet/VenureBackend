const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    venue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
    },
    //  Strict Datetime tracking prevents race conditions
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
    selectedAddons: [
      {
        id: String,
        name: String,
        price: Number,
        perPerson: Boolean,
      },
    ],
    totalPrice: {
      type: Number,
      required: true,
    },
    paymentDetails: {
      paymentIntentId: String,
      amountReceived: Number,
      paymentMethod: String,
      status: String,
    },
    status: {
      type: String,
      enum: ["pending_payment", "booked", "cancelled", "completed"],
      default: "pending_payment", // Added pending to handle Stripe flow safely
    },
  },
  { timestamps: true }
);

/* =========================================================================
   ENTERPRISE LAYER: Collision Index
   Speeds up the query when checking if a venue is already booked
========================================================================= */
bookingSchema.index({ venue: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ customer: 1 }); // Fast lookup for user dashboards

module.exports = mongoose.model("Booking", bookingSchema);