const Booking = require("../model/booking");
const Payment = require("../model/payment");
const Quotation = require("../model/quotation");
const Inquiry = require("../model/inquiry");
const Venue = require("../model/venue");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const PaymentAttempt = require("../model/paymentAttempt");
const { ACTIVE_BOOKING_STATUSES } = require("./paymentService");

// How long an unfinished slot claim may live before MongoDB removes it
const CLAIM_TTL_MS = 2 * 60 * 1000;

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

/* ========================
   CORE BOOKING CREATION (post quotation-acceptance + deposit payment)
======================== */
const createBookingFromQuotation = async ({ quotationId, transactionId, amountNPR }, customerId) => {
  // A payment can only ever back one booking
  const alreadyUsed = await Payment.exists({ transactionId });
  if (alreadyUsed) throw new AppError("This payment has already been used for a booking.", 409);

  const quotation = await Quotation.findById(quotationId).populate("inquiry");
  if (!quotation) throw new AppError("Quotation not found", 404);
  if (quotation.inquiry.customer.toString() !== customerId.toString()) {
    throw new AppError("You do not have permission to complete this booking.", 403);
  }
  if (quotation.status !== "accepted") {
    throw new AppError(`A ${quotation.status} quotation cannot be booked`, 400);
  }
  if (amountNPR !== quotation.depositAmount) {
    throw new AppError("Payment does not match this booking.", 400);
  }

  // Claim the slot, then verify nobody else holds it.
  // A plain "check, then insert" lets two simultaneous requests both pass the check.
  // Instead we insert a claim first and only then look for other bookings: whichever
  // request inserts second always sees the first, so two can never both succeed.
  let claim, paymentDoc;
  try {
    claim = await Booking.create({
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
      holdClaimExpiresAt: new Date(Date.now() + CLAIM_TTL_MS),
    });

    paymentDoc = await Payment.create({
      booking: claim._id,
      type: "deposit",
      provider: "esewa",
      transactionId,
      amountReceived: amountNPR,
      currency: "npr",
      amountNPR,
      status: "succeeded",
      verifiedAt: new Date(),
    });

    const conflict = await Booking.exists({
      _id: { $ne: claim._id },
      space: quotation.space,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      startTime: { $lt: quotation.endTime },
      endTime: { $gt: quotation.startTime },
    });
    if (conflict) {
      throw new AppError("The space is already booked during this time slot", 409);
    }

    const booking = await Booking.findByIdAndUpdate(
      claim._id,
      { status: "confirmed", $unset: { holdClaimExpiresAt: 1 } },
      { new: true }
    );

    await Inquiry.findByIdAndUpdate(quotation.inquiry._id, { booking: booking._id });

    return booking;
  } catch (error) {
    if (paymentDoc) await Payment.deleteOne({ _id: paymentDoc._id });
    if (claim) await Booking.deleteOne({ _id: claim._id, status: "pending_deposit" });

    // Duplicate transactionId means a concurrent request already booked with this payment
    if (error.code === 11000) {
      throw new AppError("This payment has already been used for a booking.", 409);
    }
    // The customer has paid but we could not book: mark the attempt so the deposit is refunded.
    await PaymentAttempt.updateOne({ transactionCode: transactionId }, { status: "refund_due" });
    logger.error({ message: "REFUND REQUIRED: deposit paid but booking failed", transactionId, quotationId: String(quotationId), reason: error.message });
    if (error.isOperational) {
      throw new AppError(`${error.message}. Your deposit will be refunded; Venure will contact you.`, error.statusCode);
    }
    logger.error({ message: "Booking creation failed", error: error.message });
    throw new AppError("We could not complete your booking. Your deposit will be refunded; Venure will contact you.", 500);
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

const getMonthlyEarningsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  const venueIds = ownerVenues.map((v) => v._id);

  const currentYear = new Date().getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);

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
        _id: { $month: "$startTime" },
        totalEarnings: { $sum: "$totalPrice" },
        bookingCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return Array.from({ length: 12 }, (_, i) => {
    const monthData = earnings.find((e) => e._id === i + 1);
    return {
      month: new Date(0, i).toLocaleString("default", { month: "short" }),
      totalEarnings: monthData?.totalEarnings || 0,
      bookingCount: monthData?.bookingCount || 0,
    };
  });
};

/* ========================
   STATUS MODIFICATIONS
======================== */
const findBookingWithVenue = async (bookingId) => {
  const booking = await Booking.findById(bookingId).populate("venue", "owner");
  if (!booking) throw new AppError("Booking not found", 404);
  return booking;
};

const isVenueOwner = (booking, userId) =>
  booking.venue?.owner && booking.venue.owner.toString() === userId.toString();

const getRefundPercentage = (cancellationPolicy, daysUntilEvent) => {
  const tiers = cancellationPolicy?.length ? cancellationPolicy : CANCELLATION_REFUND_TIERS;
  const sorted = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const tier = sorted.find((t) => daysUntilEvent >= t.minDaysBefore);
  return tier ? tier.refundPercentage : 0;
};

// Customer, venue owner, or an admin can cancel. Customer cancellation follows
// the booking's snapshotted tiered refund schedule; owner/admin cancellation
// always refunds the deposit in full (the venue failed to honor the deal).
const cancelBooking = async (bookingId, user) => {
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
  if (isCustomer && booking.startTime.getTime() <= Date.now()) {
    throw new AppError("Past or ongoing bookings cannot be cancelled", 400);
  }

  const daysUntilEvent = (booking.startTime.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  const refundPercentage = isCustomer ? getRefundPercentage(booking.cancellationPolicy, daysUntilEvent) : 100;
  const refundAmount = Math.round(booking.depositAmount * (refundPercentage / 100));

  if (refundAmount > 0) {
    const depositPayment = await Payment.findOne({ booking: booking._id, type: "deposit" });
    if (depositPayment?.transactionId) {
      await recordRefundDue(depositPayment, booking._id, refundAmount, "booking cancelled");
    }
  }

  booking.status = "cancelled";
  await booking.save();
  return booking;
};

const completeBooking = async (bookingId, user) => {
  const booking = await findBookingWithVenue(bookingId);
  if (!isVenueOwner(booking, user._id) && user.role !== "Admin") {
    throw new AppError("You do not have permission to modify this booking.", 403);
  }
  if (booking.status !== "confirmed") {
    throw new AppError(`A ${booking.status} booking cannot be marked complete`, 400);
  }

  booking.status = "completed";
  await booking.save();
  return booking;
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

  booking.balanceSettled = true;
  booking.balanceSettledAt = new Date();
  booking.balanceSettledMethod = note ? `${method} - ${note}` : method;
  booking.balanceSettledBy = ownerId;
  await booking.save();
  return booking;
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
};
