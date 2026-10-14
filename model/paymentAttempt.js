const mongoose = require("mongoose");

// One row per time a customer is sent to eSewa to pay a quotation's deposit.
// The server decides the amount here, so the callback can never change it.
const PaymentAttemptSchema = new mongoose.Schema(
  {
    quotation: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, enum: ["esewa"], default: "esewa" },
    transactionUuid: { type: String, required: true, unique: true },
    amountNPR: { type: Number, required: true },
    status: { type: String, enum: ["initiated", "completed", "failed", "refund_due"], default: "initiated" },
    // eSewa's own reference for a completed payment
    transactionCode: String,
  },
  { timestamps: true }
);

module.exports = mongoose.models.PaymentAttempt || mongoose.model("PaymentAttempt", PaymentAttemptSchema);
