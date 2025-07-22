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
      type: String,
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
      paymentIntentId: String,
      amountReceived: Number,
      paymentMethod: String,
      status: String,
    },

    status: {
      type: String,
      enum: ["booked", "cancelled", "completed", "approved"],
      default: "booked",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", bookingSchema);
