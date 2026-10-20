const mongoose = require("mongoose");
const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Quotation = require("../model/quotation");
const Inquiry = require("../model/inquiry");
const Venue = require("../model/venue");
const AppError = require("../utils/AppError");
const { nepalCalendarDay, NEPAL_OFFSET_MS } = require("./shiftService");
const logger = require("../utils/logger");
const PaymentAttempt = require("../model/paymentAttempt");
const { liveBookingFilter, findConflict, purgeExpiredClaims } = require("./slotService");
const { notifyOwner, notifyCustomer } = require("./inquiryService");

// How long an unfinished slot claim may live before MongoDB removes it
const CLAIM_TTL_MS = 2 * 60 * 1000;
// A payment record is written one insert before its claim; without a booking for longer than this it is orphaned
const PAYMENT_TO_CLAIM_GRACE_MS = 2000;

// Snapshotted onto every Booking at creation time so cancellation terms stay
// auditable even if the platform-wide policy changes later.
const CANCELLATION_REFUND_TIERS = [
  { minDaysBefore: 30, refundPercentage: 100 },
  { minDaysBefore: 15, refundPercentage: 75 },
  { minDaysBefore: 7, refundPercentage: 50 },
  { minDaysBefore: 0, refundPercentage: 0 },
];

// eSewa has no refund API we can call, so refunds are recorded as "pending" and paid back
// by Venure outside the app. A customer must never be left without a record of what they are owed.
const recordRefundDue = async (depositPayment, bookingId, amountNPR, reason) => {
  logger.warn({ message: "Refund due to customer", transactionId: depositPayment.transactionId, amountNPR, reason });
  return Payment.create({
    booking: bookingId,
    type: "refund",
    provider: depositPayment.provider,
    transactionId: `refund-${depositPayment.transactionId}`,
    amountReceived: -amountNPR,
    currency: depositPayment.currency,
    amountNPR: -amountNPR,
    status: "pending",
    verifiedAt: new Date(),
  });
};

// The calendar day of an event as people in Nepal read it
const eventDay = (date) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kathmandu" });

// A failed notification must never undo the booking or cancellation it is about
const tryNotify = async (send) => {
  try {
    await send();
  } catch (err) {
    logger.error({ message: "Booking notification failed", error: err.message });
  }
};

// Tells the venue owner a deposit was paid and the date is now theirs.
const notifyBookingConfirmed = async (booking, io) => {
  const venue = await Venue.findById(booking.venue).select("owner venueName");
  if (!venue) return;
  await tryNotify(() =>
    notifyOwner(venue, `A deposit was paid and "${venue.venueName}" is booked for ${eventDay(booking.startTime)}.`, "/owner/bookings", io)
  );
  await tryNotify(() =>
    notifyCustomer(booking.customer, `Your date at "${venue.venueName}" on ${eventDay(booking.startTime)} is confirmed.`, "/my-bookings", io)
  );
};

/* ========================
   CORE BOOKING CREATION (post quotation-acceptance + deposit payment)
======================== */
// Is this the MongoDB duplicate-key error from the slot-key index (a second booking for the same minutes)?
const isSlotCollision = (error) =>
  error?.code === 11000 && /slotKeys|active_slot_keys_unique/.test(`${error.message} ${JSON.stringify(error.keyPattern || {})}`);

// The deposit is already paid and recorded for a transactionId that came in again. Returns the booking when
// this is a harmless replay (same customer, booking confirmed), waits briefly for one still being confirmed
// by a concurrent request, and clears the leftovers of a claim that died before it was confirmed.
const settleReplay = async (transactionId, customerId, quotationId) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const payment = await Payment.findOne({ transactionId });
    if (!payment) return null; // gone in the meantime: the caller may proceed
    const booking = await Booking.findById(payment.booking);

    if (booking && ["confirmed", "completed"].includes(booking.status)) {
      // Only a repeat for the same customer and the same quotation is a replay; a payment code is never reusable elsewhere
      if (booking.customer.toString() !== customerId.toString() || String(booking.quotation) !== String(quotationId)) {
        throw new AppError("This payment has already been used for a booking.", 409);
      }
      booking.$locals.replayed = true;
      return booking;
    }
    // The payment record is written just BEFORE the claim, so a payment without a booking can simply be a request
    // that is one insert away from creating it: that counts as alive for a short grace (releasing it here would
    // delete the payment of a booking that is about to be confirmed). A claim removed by the TTL monitor leaves the
    // same picture, which is why the grace is short.
    const claimAlive = booking
      ? booking.status === "pending_deposit" && !(booking.holdClaimExpiresAt && booking.holdClaimExpiresAt <= new Date())
      : Date.now() - payment.createdAt.getTime() < PAYMENT_TO_CLAIM_GRACE_MS;
    if (claimAlive) {
      await new Promise((resolve) => setTimeout(resolve, 100)); // another request is confirming it right now
      continue;
    }
    if (booking && booking.status === "cancelled") throw new AppError("This payment has already been used for a booking.", 409);
    // The claim crashed or expired: the payment backs no booking. Release it so this retry can book.
    if (booking) await Booking.deleteOne({ _id: booking._id, status: "pending_deposit" });
    await Payment.deleteOne({ _id: payment._id, type: "deposit" });
    return null;
  }
  throw new AppError("This payment is still being processed. Please check My Bookings in a moment.", 409);
};

const createBookingFromQuotation = async ({ quotationId, transactionId, amountNPR }, customerId) => {
  if (typeof transactionId !== "string" || !transactionId || !Number.isFinite(amountNPR)) {
    throw new AppError("Payment does not match this booking.", 400);
  }

  const quotation = await Quotation.findById(quotationId).populate("inquiry");
  if (!quotation) throw new AppError("Quotation not found", 404);
  if (quotation.inquiry.customer.toString() !== customerId.toString()) {
    throw new AppError("You do not have permission to complete this booking.", 403);
  }

  // A payment can only ever back one booking. A repeat of one that already succeeded is not an error.
  if (await Payment.exists({ transactionId })) {
    const replayed = await settleReplay(transactionId, customerId, quotation._id);
    if (replayed) return replayed;
  }

  // From here on the customer's money is in (the caller verified it): any failure must leave a refund trail.
  const owed = async (message, status) => {
    await PaymentAttempt.updateOne({ transactionCode: transactionId, status: { $ne: "refund_due" } }, { status: "refund_due" });
    logger.error({ message: "REFUND REQUIRED: deposit paid but booking failed", transactionId, quotationId: String(quotationId), reason: message });
    throw new AppError(`${message}. Your deposit will be refunded; Venure will contact you.`, status);
  };

  if (quotation.status !== "accepted") await owed(`A ${quotation.status} quotation cannot be booked`, 400);
  if (amountNPR !== quotation.depositAmount) await owed("Payment does not match this booking", 400);
  if (quotation.startTime <= new Date()) await owed("This event date has already passed", 400);

  // One quotation, one booking: a second payment for it is refunded rather than booked twice
  if (await Booking.exists({ quotation: quotation._id, ...liveBookingFilter() })) {
    // ...unless that booking is the one this very payment (a simultaneous delivery of the same callback) is creating
    const replayed = await settleReplay(transactionId, customerId, quotation._id);
    if (replayed) return replayed;
    await owed("This quotation has already been booked", 409);
  }

  // Claim the slot, then verify nobody else holds it.
  // A plain "check, then insert" lets two simultaneous requests both pass the check. Instead we insert a
  // claim first. For shift bookings the claim carries one key per minute and a unique index makes MongoDB
  // reject an overlapping claim outright, so exactly one concurrent request wins. The query afterwards
  // covers what the index cannot see (bookings stored before keys existed, or off-the-minute times).
  // The payment record is written before the claim: its unique transactionId serialises replays of the
  // same callback, so a duplicate can never make the original lose the slot.
  const bookingId = new mongoose.Types.ObjectId();
  let claim = null;
  let paymentDoc = null;
  try {
    paymentDoc = await Payment.create({
      booking: bookingId,
      type: "deposit",
      provider: "esewa",
      transactionId,
      amountReceived: amountNPR,
      currency: "npr",
      amountNPR,
      status: "succeeded",
      verifiedAt: new Date(),
    });

    const claimFields = {
      _id: bookingId,
      inquiry: quotation.inquiry._id,
      quotation: quotation._id,
      customer: customerId,
      venue: quotation.venue,
      space: quotation.space,
      eventDate: quotation.eventDate,
      shift: quotation.shift,
      startTime: quotation.startTime,
      endTime: quotation.endTime,
      numberOfGuests: quotation.numberOfGuests,
      eventType: quotation.inquiry.eventType,
      specialRequirements: quotation.inquiry.message,
      contactName: quotation.inquiry.contactName,
      phoneNumber: quotation.inquiry.phoneNumber,
      totalPrice: quotation.totalPrice,
      depositAmount: quotation.depositAmount,
      balanceAmount: quotation.balanceAmount,
      cancellationPolicy: CANCELLATION_REFUND_TIERS,
      status: "pending_deposit",
    };

    for (let tries = 0; !claim; tries++) {
      try {
        claim = await Booking.create({ ...claimFields, holdClaimExpiresAt: new Date(Date.now() + CLAIM_TTL_MS) });
      } catch (error) {
        if (!isSlotCollision(error)) throw error;
        // The slot looks held. If the holder is a claim that expired (the TTL monitor has not run yet), it does not count.
        const purged = await purgeExpiredClaims(quotation);
        if (purged.length === 0 || tries >= 3) throw new AppError("The space is already booked during this time slot", 409);
        await Payment.deleteMany({ booking: { $in: purged.map((b) => b._id) }, type: "deposit" });
      }
    }

    if (await findConflict({ space: quotation.space, startTime: quotation.startTime, endTime: quotation.endTime, excludeId: claim._id })) {
      throw new AppError("The space is already booked during this time slot", 409);
    }

    // Confirm only while the claim is still ours: if it expired, someone else may legitimately hold the slot now
    const booking = await Booking.findOneAndUpdate(
      { _id: claim._id, status: "pending_deposit", holdClaimExpiresAt: { $gt: new Date() } },
      { status: "confirmed", $unset: { holdClaimExpiresAt: 1 } },
      { new: true }
    );
    if (!booking) throw new AppError("The booking could not be completed in time", 409);

    // The booking is confirmed and paid for. Linking it from the inquiry is bookkeeping: if it fails the
    // booking must stay (undoing it here would leave a confirmed booking with its payment deleted).
    try {
      await Inquiry.findByIdAndUpdate(quotation.inquiry._id, { booking: booking._id });
    } catch (linkError) {
      logger.error({ message: "Booking confirmed but the inquiry could not be linked", bookingId: String(booking._id), error: linkError.message });
    }

    return booking;
  } catch (error) {
    // A duplicate transactionId means a concurrent request is booking with this very payment: its work stays untouched.
    if (error.code === 11000 && !isSlotCollision(error) && !paymentDoc) {
      const replayed = await settleReplay(transactionId, customerId, quotation._id);
      if (replayed) return replayed;
      throw new AppError("This payment has already been used for a booking.", 409);
    }

    if (paymentDoc) await Payment.deleteOne({ _id: paymentDoc._id });
    if (claim) await Booking.deleteOne({ _id: claim._id, status: "pending_deposit" });

    if (error.isOperational) return owed(error.message, error.statusCode);
    logger.error({ message: "Booking creation failed", error: error.message });
    return owed("We could not complete your booking", 500);
  }
};

/* ========================
   OWNER DASHBOARD LOGIC
======================== */
const autoCompletePastBookings = async (filter = {}) => {
  await Booking.updateMany(
    { ...filter, status: "confirmed", endTime: { $lt: new Date() } },
    { status: "completed" }
  );
};

const getBookingsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  const venueIds = ownerVenues.map((v) => v._id);

  await autoCompletePastBookings({ venue: { $in: venueIds } });

  return await Booking.find({ venue: { $in: venueIds } })
    .populate("venue", "venueName location")
    .populate("space", "name")
    .populate("customer", "name email");
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getMonthlyEarningsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  const venueIds = ownerVenues.map((v) => v._id);

  // Calendar years and months are Nepal's, whatever time zone the server runs in
  const currentYear = nepalCalendarDay(new Date()).getUTCFullYear();
  const startOfYear = new Date(Date.UTC(currentYear, 0, 1) - NEPAL_OFFSET_MS);
  const endOfYear = new Date(Date.UTC(currentYear + 1, 0, 1) - NEPAL_OFFSET_MS - 1);

  // Sums totalPrice (the full "booked value"), not just the eSewa-verified
  // deposit — most of the contract value never flows through Venure.
  const earnings = await Booking.aggregate([
    {
      $match: {
        venue: { $in: venueIds },
        status: { $in: ["confirmed", "completed"] },
        startTime: { $gte: startOfYear, $lte: endOfYear },
      },
    },
    {
      $group: {
        _id: { $month: { date: "$startTime", timezone: "Asia/Kathmandu" } },
        totalEarnings: { $sum: "$totalPrice" },
        bookingCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return Array.from({ length: 12 }, (_, i) => {
    const monthData = earnings.find((e) => e._id === i + 1);
    return {
      month: MONTH_NAMES[i],
      totalEarnings: monthData?.totalEarnings || 0,
      bookingCount: monthData?.bookingCount || 0,
    };
  });
};

/* ========================
   STATUS MODIFICATIONS
======================== */
const findBookingWithVenue = async (bookingId) => {
  const booking = await Booking.findById(bookingId).populate("venue", "owner venueName");
  if (!booking) throw new AppError("Booking not found", 404);
  return booking;
};

const isVenueOwner = (booking, userId) =>
  booking.venue?.owner && booking.venue.owner.toString() === userId.toString();

const getRefundPercentage = (cancellationPolicy, daysUntilEvent) => {
  const tiers = cancellationPolicy?.length ? cancellationPolicy : CANCELLATION_REFUND_TIERS;
  const sorted = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const tier = sorted.find((t) => daysUntilEvent >= t.minDaysBefore);
  // Never refund more than the deposit, whatever a stored policy says
  return tier ? Math.min(100, Math.max(0, tier.refundPercentage)) : 0;
};

// Whole rupees owed back. Integer maths first (deposit x percent), so 75% of 33,333 is not at the mercy of floating point.
const refundAmountFor = (depositAmount, refundPercentage) => Math.round((depositAmount * refundPercentage) / 100);

// Customer, venue owner, or an admin can cancel. Customer cancellation follows
// the booking's snapshotted tiered refund schedule; owner/admin cancellation
// always refunds the deposit in full (the venue failed to honor the deal).
const cancelBooking = async (bookingId, user, io) => {
  const booking = await findBookingWithVenue(bookingId);

  const isCustomer = booking.customer.toString() === user._id.toString();
  const isAdmin = user.role === "Admin";
  const isOwner = isVenueOwner(booking, user._id);
  if (!isCustomer && !isAdmin && !isOwner) {
    throw new AppError("You do not have permission to modify this booking.", 403);
  }
  if (!["pending_deposit", "confirmed"].includes(booking.status)) {
    throw new AppError(`A ${booking.status} booking cannot be cancelled`, 400);
  }
  const now = Date.now();
  if (isCustomer && booking.startTime.getTime() <= now) {
    throw new AppError("Past or ongoing bookings cannot be cancelled", 400);
  }

  const daysUntilEvent = (booking.startTime.getTime() - now) / (24 * 60 * 60 * 1000);
  const refundPercentage = isCustomer ? getRefundPercentage(booking.cancellationPolicy, daysUntilEvent) : 100;
  const refundAmount = refundAmountFor(booking.depositAmount, refundPercentage);

  // The status change is the one decision point: it only succeeds for a booking that is still pending or
  // confirmed, so two simultaneous cancels (or a cancel racing a completion) cannot both go through.
  const cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: ["pending_deposit", "confirmed"] } },
    { status: "cancelled" },
    { new: true }
  ).populate("venue", "owner venueName");
  if (!cancelled) {
    const current = await Booking.findById(booking._id).select("status");
    throw new AppError(`A ${current?.status || "missing"} booking cannot be cancelled`, 400);
  }

  if (refundAmount > 0) {
    try {
      const depositPayment = await Payment.findOne({ booking: booking._id, type: "deposit" });
      if (depositPayment?.transactionId) {
        await recordRefundDue(depositPayment, booking._id, refundAmount, "booking cancelled");
      }
    } catch (error) {
      // The refund id is unique per deposit: a duplicate means it is already on record. Anything else undoes the cancel.
      if (error.code !== 11000) {
        await Booking.updateOne({ _id: booking._id, status: "cancelled" }, { status: booking.status });
        throw error;
      }
    }
  }
  booking.status = cancelled.status;

  // Tell the other side: the owner when the customer cancels, the customer when the venue (or an admin) does
  const venueName = cancelled.venue?.venueName;
  if (venueName) {
    if (isCustomer) {
      await tryNotify(() =>
        notifyOwner(cancelled.venue, `A booking at "${venueName}" on ${eventDay(booking.startTime)} was cancelled by the customer.`, "/owner/bookings", io)
      );
    } else {
      await tryNotify(() =>
        notifyCustomer(
          cancelled.customer,
          `Your booking at "${venueName}" on ${eventDay(booking.startTime)} was cancelled by the venue. Your full deposit will be refunded.`,
          "/my-bookings",
          io
        )
      );
    }
  }
  return cancelled;
};

const completeBooking = async (bookingId, user) => {
  const booking = await findBookingWithVenue(bookingId);
  if (!isVenueOwner(booking, user._id) && user.role !== "Admin") {
    throw new AppError("You do not have permission to modify this booking.", 403);
  }
  if (booking.status !== "confirmed") {
    throw new AppError(`A ${booking.status} booking cannot be marked complete`, 400);
  }

  const completed = await Booking.findOneAndUpdate({ _id: booking._id, status: "confirmed" }, { status: "completed" }, { new: true });
  if (!completed) {
    const current = await Booking.findById(booking._id).select("status");
    throw new AppError(`A ${current?.status || "missing"} booking cannot be marked complete`, 400);
  }
  return completed;
};

// The balance is settled outside the app (cash/bank transfer); this just records it.
const settleBalance = async (bookingId, ownerId, { method, note }) => {
  const booking = await findBookingWithVenue(bookingId);
  if (!isVenueOwner(booking, ownerId)) {
    throw new AppError("You do not have permission to modify this booking.", 403);
  }
  if (booking.balanceSettled) {
    throw new AppError("The balance for this booking has already been recorded as settled", 400);
  }
  if (!["confirmed", "completed"].includes(booking.status)) {
    throw new AppError(`The balance of a ${booking.status} booking cannot be settled`, 400);
  }

  // Compare-and-set: of two simultaneous requests only one records the settlement
  const settled = await Booking.findOneAndUpdate(
    { _id: booking._id, balanceSettled: { $ne: true }, status: { $in: ["confirmed", "completed"] } },
    {
      balanceSettled: true,
      balanceSettledAt: new Date(),
      balanceSettledMethod: String(note ? `${method} - ${note}` : method),
      balanceSettledBy: ownerId,
    },
    { new: true }
  );
  if (!settled) throw new AppError("The balance for this booking has already been recorded as settled", 400);
  return settled;
};

/* ========================
   AGGREGATIONS & COUNTS
======================== */
const getCustomerBookings = async (customerId) => {
  await autoCompletePastBookings({ customer: customerId });

  return await Booking.find({ customer: customerId })
    .populate("venue", "venueName location venueImages")
    .populate("space", "name");
};

const getCustomerBookingCount = async (customerId) => {
  return await Booking.countDocuments({ customer: customerId });
};

const getTotalBookingsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  return await Booking.countDocuments({
    venue: { $in: ownerVenues.map((v) => v._id) },
    status: { $in: ["confirmed", "completed"] },
  });
};

const getGlobalTotalBookings = async () => {
  return await Booking.countDocuments();
};

const getTopVenuesByBooking = async () => {
  return await Booking.aggregate([
    { $match: { status: { $in: ["confirmed", "completed"] } } },
    { $group: { _id: "$venue", bookingCount: { $sum: 1 } } },
    { $sort: { bookingCount: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "venues",
        localField: "_id",
        foreignField: "_id",
        as: "venueDetails",
      },
    },
    { $unwind: "$venueDetails" },
    { $match: { "venueDetails.status": "approved", "venueDetails.isDeleted": false } },
    {
      $lookup: {
        from: "spaces",
        let: { venueId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$venue", "$$venueId"] }, { $eq: ["$isActive", true] }] } } },
        ],
        as: "spaceDetails",
      },
    },
    {
      $project: {
        _id: 0,
        venueId: "$venueDetails._id",
        venueName: "$venueDetails.venueName",
        location: "$venueDetails.location",
        averageRating: "$venueDetails.averageRating",
        startingPricePerHour: { $min: "$spaceDetails.indicativePricePerHour" },
        bookingCount: 1,
      },
    },
  ]);
};

module.exports = {
  createBookingFromQuotation,
  notifyBookingConfirmed,
  getBookingsForOwner,
  getMonthlyEarningsForOwner,
  cancelBooking,
  completeBooking,
  settleBalance,
  autoCompletePastBookings,
  getCustomerBookings,
  getCustomerBookingCount,
  getTotalBookingsForOwner,
  getGlobalTotalBookings,
  getTopVenuesByBooking,
  CANCELLATION_REFUND_TIERS,
  getRefundPercentage,
  refundAmountFor,
};
