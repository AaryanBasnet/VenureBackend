const asyncHandler = require("../utils/asyncHandler");
const inquiryService = require("../services/inquiryService");

exports.createInquiry = asyncHandler(async (req, res) => {
  const io = req.app.get("io");
  const inquiry = await inquiryService.createInquiry(req.body, req.user._id, io);

  res.status(201).json({
    success: true,
    message: "Inquiry sent successfully",
    data: inquiry,
  });
});

exports.getMyInquiries = asyncHandler(async (req, res) => {
  const inquiries = await inquiryService.getInquiriesForCustomer(req.user._id);

  res.status(200).json({
    success: true,
    data: inquiries,
  });
});

exports.getOwnerInquiries = asyncHandler(async (req, res) => {
  const inquiries = await inquiryService.getInquiriesForOwner(req.user._id);

  res.status(200).json({
    success: true,
    data: inquiries,
  });
});

exports.getInquiryById = asyncHandler(async (req, res) => {
  const inquiry = await inquiryService.getInquiryById(req.params.id, req.user);

  res.status(200).json({
    success: true,
    data: inquiry,
  });
});

exports.cancelInquiry = asyncHandler(async (req, res) => {
  const inquiry = await inquiryService.cancelInquiry(req.params.id, req.user._id);

  res.status(200).json({
    success: true,
    message: "Inquiry cancelled",
    data: inquiry,
  });
});

exports.declineInquiry = asyncHandler(async (req, res) => {
  const io = req.app.get("io");
  const inquiry = await inquiryService.declineInquiry(req.params.id, req.user._id, io);

  res.status(200).json({
    success: true,
    message: "Inquiry declined",
    data: inquiry,
  });
});
