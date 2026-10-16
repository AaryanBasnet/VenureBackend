const Quotation = require("../model/quotation");
const Inquiry = require("../model/inquiry");
const Space = require("../model/space");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { resolveShiftTimes, nepalCalendarDay, lastBookableDay } = require("./shiftService");
const { notifyOwner, notifyCustomer } = require("./inquiryService");
const { findConflict } = require("./slotService");

const DEPOSIT_PERCENTAGE_MIN = 10;
const DEPOSIT_PERCENTAGE_MAX = 50;
const QUOTATION_VALIDITY_DAYS = 7;

// Money limits: an order of magnitude above any real event, low enough that sums stay exact in a double
const MAX_TOTAL_NPR = 1_000_000_000;
const MAX_LINE_QUANTITY = 100_000;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Deposit amount is always re-derived server-side — never trusted from the client.
 */
const computeDepositAmount = ({ depositType, depositValue, totalPrice }) => {
  if (typeof totalPrice !== "number" || !Number.isFinite(totalPrice) || totalPrice <= 0) {
    throw new AppError("The quotation total must be greater than 0", 400);
  }
  if (typeof depositValue !== "number" || !Number.isFinite(depositValue)) {
    throw new AppError("Deposit value must be a number", 400);
  }
  if (depositType === "percentage") {
    if (depositValue < DEPOSIT_PERCENTAGE_MIN || depositValue > DEPOSIT_PERCENTAGE_MAX) {
      throw new AppError(
        `Deposit percentage must be between ${DEPOSIT_PERCENTAGE_MIN}% and ${DEPOSIT_PERCENTAGE_MAX}%`,
        400
      );
    }
    // Whole rupees, rounded half up; the multiplication comes first so 20% of 100,000 is exactly 20,000
    const deposit = Math.round((totalPrice * depositValue) / 100);
    if (deposit < 1 || deposit >= totalPrice) {
      throw new AppError("The deposit must be at least NPR 1 and less than the total price", 400);
    }
    return deposit;
  }
  if (depositType === "fixed") {
    const deposit = round2(depositValue);
    if (deposit <= 0 || deposit >= totalPrice) {
      throw new AppError("Fixed deposit must be greater than 0 and less than the total price", 400);
    }
    return deposit;
  }
  throw new AppError("Invalid deposit type", 400);
};

/**
 * Line item prices are owner-authored but amounts are always server-computed —
 * client-sent `amount`/`totalPrice` are ignored, same "server re-derives money"
 * rule the old flat add-on catalog used to enforce. Amounts are rounded to the paisa
 * and summed as whole paisa, so 0.1 + 0.2 style float drift never reaches a total.
 */
const resolveLineItems = (lineItems, numberOfGuests) => {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new AppError("A quotation needs at least one line item", 400);
  }
  if (!Number.isFinite(numberOfGuests) || numberOfGuests < 1) {
    throw new AppError("Number of guests must be at least 1", 400);
  }

  let totalPaisa = 0;
  const resolved = lineItems.map((item) => {
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      throw new AppError("Line item quantity must be between 1 and 100000", 400);
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new AppError("Line item prices must be zero or more", 400);
    }
    const amountPaisa = Math.round(quantity * item.unitPrice * (item.perGuest ? numberOfGuests : 1) * 100);
    if (!Number.isFinite(amountPaisa) || amountPaisa > MAX_TOTAL_NPR * 100) {
      throw new AppError("A line item is too large", 400);
    }
    totalPaisa += amountPaisa;
    return {
      label: item.label,
      description: item.description,
      quantity,
      unitPrice: item.unitPrice,
      perGuest: Boolean(item.perGuest),
      amount: amountPaisa / 100,
    };
  });

  if (totalPaisa <= 0) throw new AppError("The quotation total must be greater than 0", 400);
  if (totalPaisa > MAX_TOTAL_NPR * 100) throw new AppError("The quotation total is too large", 400);
  return { lineItems: resolved, totalPrice: totalPaisa / 100 };
};

// Is another booking already holding this space during these hours? (expired claims do not count)
const slotIsTaken = ({ space, startTime, endTime }) => findConflict({ space, startTime, endTime });

// A quotation stops being acceptable the moment validUntil is reached (not one tick after)
const expireIfStale = async (quotation) => {
  if (quotation.status === "sent" && quotation.validUntil <= new Date()) {
    const expired = await Quotation.updateOne({ _id: quotation._id, status: "sent" }, { status: "expired" });
    quotation.status = "expired";
    if (expired.modifiedCount) {
      await Inquiry.updateOne({ _id: quotation.inquiry?._id || quotation.inquiry, currentQuotation: quotation._id }, { status: "pending", currentQuotation: null });
    }
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
  if (!Number.isInteger(payload.numberOfGuests) || payload.numberOfGuests < 1) {
    throw new AppError("Number of guests must be at least 1", 400);
  }
  if (payload.numberOfGuests > space.capacity) {
    throw new AppError(`This space can hold up to ${space.capacity} guests`, 400);
  }

  const eventDate = new Date(payload.eventDate);
  if (Number.isNaN(eventDate.getTime())) throw new AppError("Invalid event date", 400);
  const { startTime, endTime } = resolveShiftTimes(eventDate, payload.shift, space);
  if (startTime <= new Date()) {
    throw new AppError("The quoted event date must be in the future", 400);
  }
  if (nepalCalendarDay(eventDate) > lastBookableDay()) {
    throw new AppError("The quoted event date is too far ahead", 400);
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

  const quotation = await Quotation.create({
    inquiry: inquiry._id,
    venue: inquiry.venue._id,
    space: space._id,
    owner: ownerId,
    eventDate,
    shift: payload.shift,
    startTime,
    endTime,
    numberOfGuests: payload.numberOfGuests,
    lineItems,
    totalPrice,
    depositType: payload.depositType,
    depositValue: payload.depositValue,
    depositAmount,
    balanceAmount: round2(totalPrice - depositAmount),
    validUntil: new Date(Date.now() + QUOTATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    notes: payload.notes,
  });

  // Point the inquiry at the new quotation only while it is still open (a customer who accepted or cancelled a
  // moment ago must not have it pulled back to "quoted"), and only forwards: of two quotations sent at the
  // same moment the newer one (higher id) wins, whatever order the writes land in.
  const updated = await Inquiry.findOneAndUpdate(
    {
      _id: inquiry._id,
      status: { $in: ["pending", "quoted"] },
      $or: [{ currentQuotation: null }, { currentQuotation: { $lt: quotation._id } }],
    },
    { status: "quoted", currentQuotation: quotation._id, respondedAt: new Date() }
  );
  if (!updated) {
    await Quotation.updateOne({ _id: quotation._id, status: "sent" }, { status: "superseded" });
    const current = await Inquiry.findById(inquiry._id).select("status");
    throw new AppError(
      current && ["pending", "quoted"].includes(current.status)
        ? "A newer quotation was sent for this inquiry at the same time."
        : "This inquiry changed while you were quoting. Please review it and try again.",
      409
    );
  }

  // Every older open quotation on this inquiry is superseded by the new one.
  await Quotation.updateMany({ inquiry: inquiry._id, status: "sent", _id: { $lt: quotation._id } }, { status: "superseded" });

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

// Transitions the quotation/inquiry to "accepted". Does NOT take payment:
// the controller calls paymentService.initiateDeposit next to get the eSewa payment form.
const acceptQuotation = async (quotationId, customerId) => {
  let quotation = await Quotation.findById(quotationId).populate("inquiry");
  if (!quotation) throw new AppError("Quotation not found", 404);
  if (quotation.inquiry.customer.toString() !== customerId.toString()) {
    throw new AppError("You do not have permission to accept this quotation.", 403);
  }

  quotation = await expireIfStale(quotation);

  if (quotation.status === "expired") {
    throw new AppError("This quotation has expired. Please request a new one.", 400);
  }
  if (quotation.status !== "sent" && quotation.status !== "accepted") {
    throw new AppError(`A ${quotation.status} quotation cannot be accepted`, 400);
  }

  if (quotation.status === "sent") {
    if (quotation.startTime <= new Date()) {
      throw new AppError("This event date has already passed", 400);
    }
    // Check before accepting: a customer must not be left holding an accepted quotation for a slot someone else has booked
    if (await slotIsTaken(quotation)) {
      throw new AppError("This space is already booked during this time slot", 409);
    }
    // Two compare-and-set steps, inquiry first: the inquiry must still point at this quotation (so a newer one
    // sent a moment ago wins), then the quotation must still be "sent" and in date (so a withdrawal or the
    // expiry wins). Whichever step fails, nothing the customer was told is left half-done, and two
    // simultaneous accepts both end with the quotation accepted.
    const inquiryId = quotation.inquiry._id;
    const flipped = await Inquiry.findOneAndUpdate({ _id: inquiryId, currentQuotation: quotation._id, status: "quoted" }, { status: "accepted" });
    if (!flipped) {
      const current = await Inquiry.findById(inquiryId).select("status currentQuotation");
      const alreadyMine = current?.status === "accepted" && String(current.currentQuotation) === String(quotation._id);
      if (!alreadyMine) throw new AppError("This quotation has been replaced or is no longer open", 400);
    }

    const now = new Date();
    const accepted = await Quotation.findOneAndUpdate(
      { _id: quotation._id, status: "sent", validUntil: { $gt: now } },
      { status: "accepted", respondedAt: now },
      { new: true }
    ).populate("inquiry");
    if (!accepted) {
      const current = await Quotation.findById(quotation._id).populate("inquiry");
      if (current?.status === "accepted") return current; // a simultaneous accept got there first
      if (flipped) await Inquiry.updateOne({ _id: inquiryId, currentQuotation: quotation._id, status: "accepted" }, { status: "quoted" });
      throw new AppError(
        current?.status === "sent" || current?.status === "expired"
          ? "This quotation has expired. Please request a new one."
          : `A ${current?.status || "missing"} quotation cannot be accepted`,
        400
      );
    }
    quotation = accepted;
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

  const rejected = await Quotation.findOneAndUpdate(
    { _id: quotation._id, status: "sent" },
    { status: "rejected", respondedAt: new Date() },
    { new: true }
  );
  if (!rejected) throw new AppError("This quotation can no longer be rejected", 400);

  const inquiry = await Inquiry.findOneAndUpdate(
    { _id: quotation.inquiry._id, currentQuotation: quotation._id },
    { status: "pending", currentQuotation: null },
    { new: true }
  ).populate("venue", "owner venueName");

  if (inquiry) {
    await notifyOwner(
      inquiry.venue,
      `Your quotation for "${inquiry.venue.venueName}" was declined by the customer.`,
      `/owner/inquiries/${inquiry._id}`,
      io
    );
  }

  return rejected;
};

const withdrawQuotation = async (quotationId, ownerId, io) => {
  const quotation = await Quotation.findOne({ _id: quotationId, owner: ownerId }).populate("inquiry");
  if (!quotation) throw new AppError("Quotation not found or unauthorized", 404);
  if (quotation.status !== "sent") {
    throw new AppError(`A ${quotation.status} quotation cannot be withdrawn`, 400);
  }

  const withdrawn = await Quotation.findOneAndUpdate({ _id: quotation._id, status: "sent" }, { status: "withdrawn" }, { new: true });
  if (!withdrawn) throw new AppError("This quotation can no longer be withdrawn", 400);

  const inquiry = await Inquiry.findOneAndUpdate(
    { _id: quotation.inquiry._id, currentQuotation: quotation._id },
    { status: "declined", currentQuotation: null },
    { new: true }
  ).populate("venue", "venueName");

  if (inquiry) {
    await notifyCustomer(
      quotation.inquiry.customer,
      `The quotation for "${inquiry.venue.venueName}" was withdrawn by the venue.`,
      `/my-inquiries/${inquiry._id}`,
      io
    );
  }

  return withdrawn;
};

module.exports = {
  DEPOSIT_PERCENTAGE_MIN,
  DEPOSIT_PERCENTAGE_MAX,
  QUOTATION_VALIDITY_DAYS,
  MAX_TOTAL_NPR,
  computeDepositAmount,
  resolveLineItems,
  createQuotation,
  getQuotationById,
  acceptQuotation,
  rejectQuotation,
  withdrawQuotation,
};
