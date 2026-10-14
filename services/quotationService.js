const Quotation = require("../model/quotation");
const Inquiry = require("../model/inquiry");
const Space = require("../model/space");
const Booking = require("../model/booking");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { resolveShiftTimes } = require("./shiftService");
const { notifyOwner, notifyCustomer } = require("./inquiryService");
const { ACTIVE_BOOKING_STATUSES } = require("./paymentService");

const DEPOSIT_PERCENTAGE_MIN = 10;
const DEPOSIT_PERCENTAGE_MAX = 50;
const QUOTATION_VALIDITY_DAYS = 7;

/**
 * Deposit amount is always re-derived server-side — never trusted from the client.
 */
const computeDepositAmount = ({ depositType, depositValue, totalPrice }) => {
  if (depositType === "percentage") {
    if (depositValue < DEPOSIT_PERCENTAGE_MIN || depositValue > DEPOSIT_PERCENTAGE_MAX) {
      throw new AppError(
        `Deposit percentage must be between ${DEPOSIT_PERCENTAGE_MIN}% and ${DEPOSIT_PERCENTAGE_MAX}%`,
        400
      );
    }
    return Math.round(totalPrice * (depositValue / 100));
  }
  if (depositType === "fixed") {
    if (depositValue <= 0 || depositValue >= totalPrice) {
      throw new AppError("Fixed deposit must be greater than 0 and less than the total price", 400);
    }
    return depositValue;
  }
  throw new AppError("Invalid deposit type", 400);
};

/**
 * Line item prices are owner-authored but amounts are always server-computed —
 * client-sent `amount`/`totalPrice` are ignored, same "server re-derives money"
 * rule the old flat add-on catalog used to enforce.
 */
const resolveLineItems = (lineItems, numberOfGuests) => {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new AppError("A quotation needs at least one line item", 400);
  }

  const resolved = lineItems.map((item) => {
    const quantity = item.quantity || 1;
    const amount = item.perGuest
      ? quantity * item.unitPrice * numberOfGuests
      : quantity * item.unitPrice;
    return { ...item, quantity, amount };
  });

  const totalPrice = resolved.reduce((sum, item) => sum + item.amount, 0);
  return { lineItems: resolved, totalPrice };
};

// Is another booking already holding this space during these hours?
const slotIsTaken = ({ space, startTime, endTime }) =>
  Booking.exists({
    space,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  });

const expireIfStale = async (quotation) => {
  if (quotation.status === "sent" && quotation.validUntil < new Date()) {
    quotation.status = "expired";
    await quotation.save();
    await Inquiry.findByIdAndUpdate(quotation.inquiry, { status: "pending", currentQuotation: null });
  }
  return quotation;
};

const createQuotation = async (inquiryId, ownerId, payload, io) => {
  const inquiry = await Inquiry.findById(inquiryId).populate("venue", "owner venueName");
  if (!inquiry || inquiry.venue.owner.toString() !== ownerId.toString()) {
    throw new AppError("Inquiry not found or unauthorized", 404);
  }
  if (!["pending", "quoted"].includes(inquiry.status)) {
    throw new AppError(`An inquiry that is ${inquiry.status} cannot be quoted`, 400);
  }

  const space = await Space.findOne({ _id: payload.space, venue: inquiry.venue._id, isActive: true });
  if (!space) throw new AppError("Space not found for this venue", 404);
  if (payload.numberOfGuests > space.capacity) {
    throw new AppError(`This space can hold up to ${space.capacity} guests`, 400);
  }

  const { startTime, endTime } = resolveShiftTimes(new Date(payload.eventDate), payload.shift, space);
  if (startTime <= new Date()) {
    throw new AppError("The quoted event date must be in the future", 400);
  }

  // Do not quote a date the space has already been booked for
  if (await slotIsTaken({ space: space._id, startTime, endTime })) {
    throw new AppError("This space is already booked on that date and shift", 409);
  }

  const { lineItems, totalPrice } = resolveLineItems(payload.lineItems, payload.numberOfGuests);
  const depositAmount = computeDepositAmount({
    depositType: payload.depositType,
    depositValue: payload.depositValue,
    totalPrice,
  });

  // A previous active quote on this inquiry is superseded by the new one.
  if (inquiry.currentQuotation) {
    await Quotation.findOneAndUpdate(
      { _id: inquiry.currentQuotation, status: "sent" },
      { status: "superseded" }
    );
  }

  const quotation = await Quotation.create({
    inquiry: inquiry._id,
    venue: inquiry.venue._id,
    space: space._id,
    owner: ownerId,
    eventDate: payload.eventDate,
    shift: payload.shift,
    startTime,
    endTime,
    numberOfGuests: payload.numberOfGuests,
    lineItems,
    totalPrice,
    depositType: payload.depositType,
    depositValue: payload.depositValue,
    depositAmount,
    balanceAmount: totalPrice - depositAmount,
    validUntil: new Date(Date.now() + QUOTATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    notes: payload.notes,
  });

  inquiry.status = "quoted";
  inquiry.currentQuotation = quotation._id;
  inquiry.respondedAt = new Date();
  await inquiry.save();

  await notifyCustomer(
    inquiry.customer,
    `You've received a quotation for "${inquiry.venue.venueName}".`,
    `/my-inquiries/${inquiry._id}`,
    io
  );
  logger.info(`Quotation sent: ${quotation._id}`);

  return quotation;
};

const getQuotationById = async (quotationId, user) => {
  let quotation = await Quotation.findById(quotationId)
    .populate("venue", "venueName owner")
    .populate("space", "name capacity")
    .populate({ path: "inquiry", select: "customer" });
  if (!quotation) throw new AppError("Quotation not found", 404);

  quotation = await expireIfStale(quotation);

  const isCustomer = quotation.inquiry.customer.toString() === user._id.toString();
  const isOwner = quotation.venue.owner.toString() === user._id.toString();
  if (!isCustomer && !isOwner && user.role !== "Admin") {
    throw new AppError("You do not have permission to view this quotation.", 403);
  }

  return quotation;
};

// Transitions the quotation/inquiry to "accepted". Does NOT take payment —
// the controller calls paymentService.initiateDeposit next to get the eSewa payment form.
const acceptQuotation = async (quotationId, customerId) => {
  let quotation = await Quotation.findById(quotationId).populate("inquiry");
  if (!quotation) throw new AppError("Quotation not found", 404);

  quotation = await expireIfStale(quotation);

  if (quotation.inquiry.customer.toString() !== customerId.toString()) {
    throw new AppError("You do not have permission to accept this quotation.", 403);
  }
  if (quotation.status === "expired") {
    throw new AppError("This quotation has expired. Please request a new one.", 400);
  }
  if (quotation.status !== "sent" && quotation.status !== "accepted") {
    throw new AppError(`A ${quotation.status} quotation cannot be accepted`, 400);
  }

  if (quotation.status === "sent") {
    // Check before accepting: a customer must not be left holding an accepted quotation for a slot someone else has booked
    if (await slotIsTaken(quotation)) {
      throw new AppError("This space is already booked during this time slot", 409);
    }
    quotation.status = "accepted";
    quotation.respondedAt = new Date();
    await quotation.save();

    await Inquiry.findByIdAndUpdate(quotation.inquiry._id, { status: "accepted" });
  }

  return quotation;
};

const rejectQuotation = async (quotationId, customerId, io) => {
  const quotation = await Quotation.findById(quotationId).populate("inquiry");
  if (!quotation || quotation.inquiry.customer.toString() !== customerId.toString()) {
    throw new AppError("Quotation not found or unauthorized", 404);
  }
  if (quotation.status !== "sent") {
    throw new AppError(`A ${quotation.status} quotation cannot be rejected`, 400);
  }

  quotation.status = "rejected";
  quotation.respondedAt = new Date();
  await quotation.save();

  const inquiry = await Inquiry.findByIdAndUpdate(
    quotation.inquiry._id,
    { status: "pending", currentQuotation: null },
    { new: true }
  ).populate("venue", "owner venueName");

  await notifyOwner(
    inquiry.venue,
    `Your quotation for "${inquiry.venue.venueName}" was declined by the customer.`,
    `/owner/inquiries/${inquiry._id}`,
    io
  );

  return quotation;
};

const withdrawQuotation = async (quotationId, ownerId, io) => {
  const quotation = await Quotation.findOne({ _id: quotationId, owner: ownerId }).populate("inquiry");
  if (!quotation) throw new AppError("Quotation not found or unauthorized", 404);
  if (quotation.status !== "sent") {
    throw new AppError(`A ${quotation.status} quotation cannot be withdrawn`, 400);
  }

  quotation.status = "withdrawn";
  await quotation.save();

  const inquiry = await Inquiry.findByIdAndUpdate(
    quotation.inquiry._id,
    { status: "declined", currentQuotation: null },
    { new: true }
  ).populate("venue", "venueName");

  await notifyCustomer(
    quotation.inquiry.customer,
    `The quotation for "${inquiry.venue.venueName}" was withdrawn by the venue.`,
    `/my-inquiries/${inquiry._id}`,
    io
  );

  return quotation;
};

module.exports = {
  DEPOSIT_PERCENTAGE_MIN,
  DEPOSIT_PERCENTAGE_MAX,
  QUOTATION_VALIDITY_DAYS,
  computeDepositAmount,
  resolveLineItems,
  createQuotation,
  getQuotationById,
  acceptQuotation,
  rejectQuotation,
  withdrawQuotation,
};
