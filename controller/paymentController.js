const asyncHandler = require("../utils/asyncHandler");
const paymentService = require("../services/paymentService");

exports.createPaymentIntent = asyncHandler(async (req, res) => {
  // req.body contains the provider ("stripe" or "esewa")
  const paymentData = await paymentService.initiatePayment(req.body, req.user._id);

  res.status(200).json({
    success: true,
    data: paymentData,
  });
});