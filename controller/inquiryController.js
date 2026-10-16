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

exports.assertCanAttach = asyncHandler(async (req, res, next) => {
  await inquiryService.assertCanAttach(req.params.id, req.user._id);
  next();
});

exports.addAttachments = asyncHandler(async (req, res) => {
  const inquiry = await inquiryService.addAttachments(req.params.id, req.user._id, req.files);
  res.status(201).json({ success: true, message: "File added", data: inquiry });
});

exports.removeAttachment = asyncHandler(async (req, res) => {
  const inquiry = await inquiryService.removeAttachment(req.params.id, req.params.attachmentId, req.user._id);
  res.status(200).json({ success: true, message: "File removed", data: inquiry });
});

// JSON, not a redirect: the page asks with its cookie, then opens the short-lived link.
exports.getAttachmentLink = asyncHandler(async (req, res) => {
  const url = await inquiryService.getAttachmentLink(req.params.id, req.params.attachmentId, req.user);
  res.status(200).json({ success: true, data: { url } });
});
