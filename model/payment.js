const mongoose = require("mongoose");

// Replaces the old embedded Booking.paymentDetails — a booking can now have more
// than one payment (deposit now, balance/refund later).
const PaymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    // Only "deposit" is wired up to a real flow this round; "balance"/"refund"
    // are here so settle-balance/cancellation records have somewhere to live.
    type: {
      type: String,
      enum: ["deposit", "balance", "refund"],
      required: true,
    },
    provider: {
      type: String,
      enum: ["stripe", "esewa", "khalti"],
      default: "esewa",
    },
    transactionId: String, // eSewa transaction code (or a refund-<code> marker)
    amountReceived: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "npr",
    },
    // NPR amount, matched against the quotation
    amountNPR: {
      type: Number,
      required: true,
    },
    // Only set on old Stripe payments (USD charged at this NPR rate)
    exchangeRateUsed: Number,
    status: String, // "succeeded" | "pending" (refund owed) | "failed"
    verifiedAt: Date,
  },
  { timestamps: true }
);

// One PaymentIntent/Refund can only ever back one Payment record — same
// guarantee the old paymentDetails.transactionId unique index gave Booking.
PaymentSchema.index(
  { transactionId: 1 },
  { unique: true, partialFilterExpression: { transactionId: { $type: "string" } } }
);

module.exports = mongoose.models.Payment || mongoose.model("Payment", PaymentSchema);
