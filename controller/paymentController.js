const asyncHandler = require("../utils/asyncHandler");
const paymentService = require("../services/paymentService");

const bookingService = require("../services/bookingService");

// eSewa sends the customer back with ?data=<base64>; the frontend posts it here.
// Verifies the payment, then creates the confirmed booking.
exports.verifyEsewa = asyncHandler(async (req, res) => {
  const payment = await paymentService.verifyEsewaDeposit(req.body.data, req.user._id);
  const booking = await bookingService.createBookingFromQuotation(
    { quotationId: payment.quotationId, transactionId: payment.transactionId, amountNPR: payment.amountNPR },
    req.user._id
  );

  res.status(201).json({
    success: true,
    message: "Booking confirmed successfully",
    data: booking,
  });
});

exports.initiateDeposit = asyncHandler(async (req, res) => {
  // req.body contains { quotationId, provider }
  const paymentData = await paymentService.initiateDeposit(req.body, req.user._id);

  res.status(200).json({
    success: true,
    data: paymentData,
  });
});
