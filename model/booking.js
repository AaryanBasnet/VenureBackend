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
    bookingDate: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: String, // e.g., "slot1", "slot2"
      required: true,
    },
    hoursBooked: {
      type: Number,
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
      cardNumber: { type: String, required: true },
      expiryDate: { type: String, required: true },
      cvv: { type: String, required: true },
      cardholderName: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ["booked", "cancelled", "completed"],
      default: "booked",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", bookingSchema);
