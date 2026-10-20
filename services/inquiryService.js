const Inquiry = require("../model/inquiry");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Notification = require("../model/notification");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { cloudinary, ATTACHMENT_MAX_COUNT } = require("../middleware/uploadMiddleware");
const { nepalDaysBetween, nepalCalendarDay, lastBookableDay } = require("./shiftService");

const notifyOwner = async (venue, message, link, io) => {
  if (!venue.owner) return;
  const notification = await Notification.create({ recipient: venue.owner, type: "booking", message, link });
  if (io) io.to(venue.owner.toString()).emit("newNotification", notification);
};

const notifyCustomer = async (customerId, message, link, io) => {
  const notification = await Notification.create({ recipient: customerId, type: "booking", message, link });
  if (io) io.to(customerId.toString()).emit("newNotification", notification);
};

// A request needs at least a day's notice (tomorrow in Kathmandu is the earliest date) and cannot be
// further ahead than the date picker allows. "Tomorrow" is the Kathmandu calendar day, not the server's.
const assertPreferredDate = (preferredDate, now = new Date()) => {
  const date = new Date(preferredDate);
  if (Number.isNaN(date.getTime())) throw new AppError("Invalid date", 400);
  if (nepalDaysBetween(now, date) < 1) {
    throw new AppError("Tomorrow is the earliest date you can ask for, so the venue has time to reply", 400);
  }
  if (nepalCalendarDay(date) > lastBookableDay(now)) {
    throw new AppError("That date is too far ahead to request", 400);
  }
};

const createInquiry = async (payload, customerId, io) => {
  assertPreferredDate(payload.preferredDate);

  const venue = await Venue.findOne({ _id: { $eq: payload.venue }, isDeleted: false, status: "approved" });
  if (!venue) throw new AppError("Venue not found", 404);

  if (payload.space) {
    const space = await Space.findOne({ _id: { $eq: payload.space }, venue: venue._id, isActive: true });
    if (!space) throw new AppError("Space not found for this venue", 404);
    if (payload.numberOfGuests > space.capacity) {
      throw new AppError(`This space can hold up to ${space.capacity} guests`, 400);
    }
  }

  const inquiry = await Inquiry.create({ ...payload, customer: customerId, status: "pending" });

  await notifyOwner(
    venue,
    `New inquiry for "${venue.venueName}" from a prospective customer.`,
    `/owner/inquiries/${inquiry._id}`,
    io
  );
  logger.info(`Inquiry created: ${inquiry._id}`);

  return inquiry;
};

const getInquiriesForCustomer = async (customerId) => {
  return await Inquiry.find({ customer: customerId })
    .populate("venue", "venueName location venueImages")
    .populate("space", "name capacity")
    .sort("-createdAt");
};

const getInquiriesForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  const venueIds = ownerVenues.map((v) => v._id);

  return await Inquiry.find({ venue: { $in: venueIds } })
    .populate("venue", "venueName")
    .populate("space", "name capacity")
    .populate("customer", "name email phone")
    .sort("-createdAt");
};

const getInquiryById = async (inquiryId, user) => {
  const inquiry = await Inquiry.findById(inquiryId)
    .populate("venue", "venueName owner")
    .populate("space", "name capacity")
    .populate("customer", "name email phone");
  if (!inquiry) throw new AppError("Inquiry not found", 404);

  const isCustomer = inquiry.customer._id.toString() === user._id.toString();
  const isOwner = inquiry.venue.owner.toString() === user._id.toString();
  if (!isCustomer && !isOwner && user.role !== "Admin") {
    throw new AppError("You do not have permission to view this inquiry.", 403);
  }

  return inquiry;
};

const cancelInquiry = async (inquiryId, customerId, reason) => {
  const inquiry = await Inquiry.findOne({ _id: inquiryId, customer: customerId });
  if (!inquiry) throw new AppError("Inquiry not found", 404);
  if (!["pending", "quoted"].includes(inquiry.status)) {
    throw new AppError(`An inquiry that is ${inquiry.status} cannot be cancelled`, 400);
  }

  inquiry.status = "cancelled";
  if (reason) inquiry.customerReason = reason;
  await inquiry.save();
  return inquiry;
};

const declineInquiry = async (inquiryId, ownerId, io, reason) => {
  const inquiry = await Inquiry.findById(inquiryId).populate("venue", "owner venueName");
  if (!inquiry || inquiry.venue.owner.toString() !== ownerId.toString()) {
    throw new AppError("Inquiry not found or unauthorized", 404);
  }
  if (!["pending", "quoted"].includes(inquiry.status)) {
    throw new AppError(`An inquiry that is ${inquiry.status} cannot be declined`, 400);
  }

  inquiry.status = "declined";
  inquiry.respondedAt = new Date();
  if (reason) inquiry.declineReason = reason;
  await inquiry.save();

  await notifyCustomer(
    inquiry.customer,
    `Your inquiry for "${inquiry.venue.venueName}" was declined${reason ? `: ${reason}` : "."}`,
    `/my-inquiries/${inquiry._id}`,
    io
  );

  return inquiry;
};

const EXTENSIONS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ATTACHABLE = ["pending", "quoted"];
const LINK_LIFETIME_SECONDS = 5 * 60;

const discardUploads = async (files) => {
  await Promise.all(
    files.map((f) =>
      cloudinary.uploader.destroy(f.filename, { resource_type: "image", type: "authenticated" }).catch((e) =>
        logger.warn(`Could not remove uploaded file ${f.filename}: ${e.message}`)
      )
    )
  );
};

// Checked before the upload so a request that cannot succeed never stores anything.
const assertCanAttach = async (inquiryId, customerId) => {
  const inquiry = await Inquiry.findOne({ _id: inquiryId, customer: customerId }).select("status attachments");
  if (!inquiry) throw new AppError("Inquiry not found", 404);
  if (!ATTACHABLE.includes(inquiry.status)) {
    throw new AppError(`Files cannot be added to an inquiry that is ${inquiry.status}`, 400);
  }
  if (inquiry.attachments.length >= ATTACHMENT_MAX_COUNT) {
    throw new AppError(`An inquiry can have up to ${ATTACHMENT_MAX_COUNT} files`, 400);
  }
};

const addAttachments = async (inquiryId, customerId, files = []) => {
  if (!files.length) throw new AppError("Choose a file to attach", 400);

  const docs = files.map((f) => ({
    publicId: f.filename,
    originalName: String(f.originalname || "attachment").slice(0, 200),
    mimeType: f.mimetype,
    size: f.size ?? 0,
  }));

  // One atomic step: the file count and the status are re-checked at the moment of writing, so two uploads
  // arriving together cannot go over the limit.
  const inquiry = await Inquiry.findOneAndUpdate(
    {
      _id: inquiryId,
      customer: customerId,
      status: { $in: ATTACHABLE },
      $expr: { $lte: [{ $add: [{ $size: "$attachments" }, docs.length] }, ATTACHMENT_MAX_COUNT] },
    },
    { $push: { attachments: { $each: docs } } },
    { new: true }
  );
  if (!inquiry) {
    await discardUploads(files);
    throw new AppError(`This inquiry cannot take more files (up to ${ATTACHMENT_MAX_COUNT}, and only while it is open)`, 409);
  }
  return inquiry;
};

const removeAttachment = async (inquiryId, attachmentId, customerId) => {
  const inquiry = await Inquiry.findOneAndUpdate(
    { _id: inquiryId, customer: customerId, status: { $in: ATTACHABLE }, "attachments._id": attachmentId },
    { $pull: { attachments: { _id: attachmentId } } },
    { new: false }
  ).select("+attachments.publicId");
  if (!inquiry) throw new AppError("File not found, or the inquiry is no longer open", 404);

  const removed = inquiry.attachments.find((a) => String(a._id) === String(attachmentId));
  if (removed) await discardUploads([{ filename: removed.publicId }]);
  return Inquiry.findById(inquiryId);
};

// A short-lived signed link, only for the customer, the venue's owner and an admin.
const getAttachmentLink = async (inquiryId, attachmentId, user) => {
  const inquiry = await Inquiry.findById(inquiryId).select("+attachments.publicId").populate("venue", "owner");
  if (!inquiry) throw new AppError("Inquiry not found", 404);

  const isCustomer = String(inquiry.customer) === String(user._id);
  const isOwner = String(inquiry.venue?.owner) === String(user._id);
  if (!isCustomer && !isOwner && user.role !== "Admin") {
    throw new AppError("You do not have permission to view this file.", 403);
  }

  const attachment = inquiry.attachments.find((a) => String(a._id) === String(attachmentId));
  if (!attachment) throw new AppError("File not found", 404);

  return cloudinary.utils.private_download_url(attachment.publicId, EXTENSIONS[attachment.mimeType] || "pdf", {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS,
  });
};

module.exports = {
  assertCanAttach,
  addAttachments,
  removeAttachment,
  getAttachmentLink,
  assertPreferredDate,
  createInquiry,
  getInquiriesForCustomer,
  getInquiriesForOwner,
  getInquiryById,
  cancelInquiry,
  declineInquiry,
  notifyOwner,
  notifyCustomer,
};
