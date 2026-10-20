const { isDemoAdmin } = require("../services/demoScope");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const service = require("../services/venueApplicationService");
const { submitApplicationSchema } = require("../validators/venueApplicationValidators");

exports.submit = asyncHandler(async (req, res) => {
  // The files are already stored by the time this runs, so any refusal below removes them again.
  const parsed = submitApplicationSchema.safeParse(req.body ?? {});
  try {
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join(", ");
      throw new AppError(`Validation Error - ${message}`, 400);
    }
    await service.submitApplication(parsed.data, req.files);
  } catch (error) {
    await service.discardFiles(service.allUploads(req.files));
    throw error;
  }
  res.status(201).json({ success: true, message: "Application received" });
});

exports.checkEmail = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { status: await service.checkEmail(req.body.email) } });
});

exports.list = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.listApplications(req.query, isDemoAdmin(req.user)) });
});

exports.get = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getApplication(req.params.id, isDemoAdmin(req.user)) });
});

exports.documentLink = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { url: await service.getDocumentLink(req.params.id, req.params.kind, isDemoAdmin(req.user)) } });
});

exports.approve = asyncHandler(async (req, res) => {
  const { venue, emailed } = await service.approveApplication(req.params.id, req.user._id);
  res.json({
    success: true,
    message: emailed ? "Application approved. The owner has been emailed." : "Application approved, but the email could not be sent. Send the link again from this page.",
    data: { venue: venue._id, emailed },
  });
});

exports.resendLink = asyncHandler(async (req, res) => {
  const { emailed } = await service.resendSetupLink(req.params.id);
  res.json({ success: true, message: emailed ? "A new link was emailed to the owner." : "The email could not be sent. Try again in a moment.", data: { emailed } });
});

exports.reject = asyncHandler(async (req, res) => {
  await service.rejectApplication(req.params.id, req.body.reason, req.user._id);
  res.json({ success: true, message: "Application rejected. The applicant has been emailed." });
});

exports.setupPassword = asyncHandler(async (req, res) => {
  const { email } = await service.setupPassword(req.body.token, req.body.password);
  res.json({ success: true, message: "Password saved. You can sign in now.", data: { email } });
});
