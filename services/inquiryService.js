const Inquiry = require("../model/inquiry");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Notification = require("../model/notification");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
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

  const venue = await Venue.findOne({ _id: payload.venue, isDeleted: false, status: "approved" });
  if (!venue) throw new AppError("Venue not found", 404);

  if (payload.space) {
    const space = await Space.findOne({ _id: payload.space, venue: venue._id, isActive: true });
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

const cancelInquiry = async (inquiryId, customerId) => {
  const inquiry = await Inquiry.findOne({ _id: inquiryId, customer: customerId });
  if (!inquiry) throw new AppError("Inquiry not found", 404);
  if (!["pending", "quoted"].includes(inquiry.status)) {
    throw new AppError(`An inquiry that is ${inquiry.status} cannot be cancelled`, 400);
  }

  inquiry.status = "cancelled";
  await inquiry.save();
  return inquiry;
};

const declineInquiry = async (inquiryId, ownerId, io) => {
  const inquiry = await Inquiry.findById(inquiryId).populate("venue", "owner venueName");
  if (!inquiry || inquiry.venue.owner.toString() !== ownerId.toString()) {
    throw new AppError("Inquiry not found or unauthorized", 404);
  }
  if (!["pending", "quoted"].includes(inquiry.status)) {
    throw new AppError(`An inquiry that is ${inquiry.status} cannot be declined`, 400);
  }

  inquiry.status = "declined";
  inquiry.respondedAt = new Date();
  await inquiry.save();

  await notifyCustomer(
    inquiry.customer,
    `Your inquiry for "${inquiry.venue.venueName}" was declined.`,
    `/my-inquiries/${inquiry._id}`,
    io
  );

  return inquiry;
};

module.exports = {
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
