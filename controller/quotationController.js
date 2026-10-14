const asyncHandler = require("../utils/asyncHandler");
const quotationService = require("../services/quotationService");
const paymentService = require("../services/paymentService");

exports.createQuotation = asyncHandler(async (req, res) => {
  const io = req.app.get("io");
  const quotation = await quotationService.createQuotation(req.params.inquiryId, req.user._id, req.body, io);

  res.status(201).json({
    success: true,
    message: "Quotation sent successfully",
    data: quotation,
  });
});

exports.getQuotationById = asyncHandler(async (req, res) => {
  const quotation = await quotationService.getQuotationById(req.params.id, req.user);

  res.status(200).json({
    success: true,
    data: quotation,
  });
});

// Accepts the quotation AND immediately starts the deposit payment, returning
// the eSewa payment form in one call. POST /api/payment/initiate-deposit exists
// separately for retrying the payment without re-triggering acceptance.
exports.acceptQuotation = asyncHandler(async (req, res) => {
  const quotation = await quotationService.acceptQuotation(req.params.id, req.user._id);
  const paymentData = await paymentService.initiateDeposit(
    { quotationId: quotation._id },
    req.user._id
  );

  res.status(200).json({
    success: true,
    data: { quotation, payment: paymentData },
  });
});

exports.rejectQuotation = asyncHandler(async (req, res) => {
  const io = req.app.get("io");
  const quotation = await quotationService.rejectQuotation(req.params.id, req.user._id, io);

  res.status(200).json({
    success: true,
    message: "Quotation rejected",
    data: quotation,
  });
});

exports.withdrawQuotation = asyncHandler(async (req, res) => {
  const io = req.app.get("io");
  const quotation = await quotationService.withdrawQuotation(req.params.id, req.user._id, io);

  res.status(200).json({
    success: true,
    message: "Quotation withdrawn",
    data: quotation,
  });
});
