const Booking = require("../model/booking");
const Venue = require("../model/venue");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { getStripe } = require("../utils/stripe");
const { quoteBooking, nprToUsdCents } = require("./pricingService");
const { ACTIVE_BOOKING_STATUSES } = require("./paymentService");

// How long an unfinished slot claim may live before MongoDB removes it
const CLAIM_TTL_MS = 2 * 60 * 1000;

const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

/**
 * Proves a Stripe PaymentIntent was paid by this customer, for this venue and slot,
 * for exactly the server-calculated amount.
 */
const assertPaymentMatchesBooking = (paymentIntent, { customerId, venueId, quote }) => {
  if (paymentIntent.status !== "succeeded") {
    throw new AppError("Payment has not been successfully completed", 400);
  }

  const meta = paymentIntent.metadata || {};
  const matches =
    meta.userId === customerId.toString() &&
    meta.venueId === venueId.toString() &&
    sameInstant(meta.startTime, quote.start) &&
    sameInstant(meta.endTime, quote.end) &&
    paymentIntent.currency === "usd" &&
    paymentIntent.amount_received === nprToUsdCents(quote.totalPrice);

  if (!matches) {
    logger.warn({
      message: "Payment does not match booking",
      customerId: customerId.toString(),
      paymentIntentId: paymentIntent.id,
    });
    throw new AppError("Payment does not match this booking.", 400);
  }
};

// Best effort: a customer must never be charged for a booking we could not create
const refundPayment = async (paymentIntentId, reason) => {
  try {
    await getStripe().refunds.create({ payment_intent: paymentIntentId });
    logger.warn({ message: "Payment refunded after failed booking", paymentIntentId, reason });
  } catch (err) {
    logger.error({ message: "AUTOMATIC REFUND FAILED - manual refund required", paymentIntentId, reason, error: err.message });
  }
};

/* ========================
   CORE BOOKING CREATION
======================== */
const createBooking = async (bookingData, customerId) => {
  const {
    venue: venueId,
    startTime,
    endTime,
    numberOfGuests,
    selectedAddons = [],
    totalPrice: frontendPrice, // Only used to detect a stale price on the client
    paymentIntentId,
    paymentDetails,
    eventType,
    specialRequirements,
    contactName,
    phoneNumber,
  } = bookingData;

  const finalPaymentIntentId = paymentIntentId || paymentDetails?.paymentIntentId;
  if (!finalPaymentIntentId) throw new AppError("Payment intent ID is missing", 400);

  // 1. A payment can only ever back one booking
  const alreadyUsed = await Booking.exists({ "paymentDetails.transactionId": finalPaymentIntentId });
  if (alreadyUsed) throw new AppError("This payment has already been used for a booking.", 409);

  // 2. Trusted price & slot validation
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);

  const quote = quoteBooking({ venue, startTime, endTime, numberOfGuests, addons: selectedAddons });

  if (frontendPrice !== undefined && Math.abs(quote.totalPrice - frontendPrice) > 1) {
    logger.warn({ message: "Booking price mismatch", customerId: customerId.toString() });
    throw new AppError("Price mismatch detected. Booking rejected.", 400);
  }

  // 3. Verify the Stripe payment belongs to exactly this booking
  const paymentIntent = await getStripe().paymentIntents.retrieve(finalPaymentIntentId);
  assertPaymentMatchesBooking(paymentIntent, { customerId, venueId, quote });

  // 4. Claim the slot, then verify nobody else holds it.
  // A plain "check, then insert" lets two simultaneous requests both pass the check.
  // Instead we insert a claim first and only then look for other bookings: whichever
  // request inserts second always sees the first, so two can never both succeed.
  // (If both claim at the same instant they can both lose; the customers are refunded
  // and can retry. Losing safely beats double-booking.)
  let claim;
  try {
    claim = await Booking.create({
      customer: customerId,
      venue: venueId,
      startTime: quote.start,
      endTime: quote.end,
      numberOfGuests,
      eventType,
      specialRequirements,
      contactName,
      phoneNumber,
      selectedAddons: quote.selectedAddons,
      totalPrice: quote.totalPrice,
      paymentDetails: {
        provider: "stripe",
        transactionId: paymentIntent.id,
        amountReceived: paymentIntent.amount_received,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      },
      status: "pending_payment",
      holdExpiresAt: new Date(Date.now() + CLAIM_TTL_MS),
    });

    const conflict = await Booking.exists({
      _id: { $ne: claim._id },
      venue: venueId,
      status: { $in: ACTIVE_BOOKING_STATUSES },
      startTime: { $lt: quote.end },
      endTime: { $gt: quote.start },
    });
    if (conflict) {
      throw new AppError("The venue is already booked during this time slot", 409);
    }

    return await Booking.findByIdAndUpdate(
      claim._id,
      { status: "booked", $unset: { holdExpiresAt: 1 } },
      { new: true }
    );
  } catch (error) {
    if (claim) await Booking.deleteOne({ _id: claim._id, status: "pending_payment" });

    // Duplicate transactionId means a concurrent request already booked with this payment
    if (error.code === 11000) {
      throw new AppError("This payment has already been used for a booking.", 409);
    }
    await refundPayment(paymentIntent.id, error.message);
    if (error.isOperational) {
      throw new AppError(`${error.message}. Your payment has been refunded.`, error.statusCode);
    }
    logger.error({ message: "Booking creation failed", error: error.message });
    throw new AppError("We could not complete your booking. Your payment has been refunded.", 500);
  }
};

/* ========================
   OWNER DASHBOARD LOGIC
======================== */
const getBookingsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  const venueIds = ownerVenues.map((v) => v._id);

  return await Booking.find({ venue: { $in: venueIds } })
    .populate("venue", "venueName location")
    .populate("customer", "name email");
};

const getMonthlyEarningsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  const venueIds = ownerVenues.map((v) => v._id);

  const currentYear = new Date().getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);

  const earnings = await Booking.aggregate([
    {
      $match: {
        venue: { $in: venueIds },
        status: { $in: ["booked", "approved", "completed"] },
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

// Only the owner of the booked venue can approve, and only a paid booking
const approveBooking = async (bookingId, user) => {
  const booking = await findBookingWithVenue(bookingId);

  if (!isVenueOwner(booking, user._id)) {
    throw new AppError("You do not have permission to modify this booking.", 403);
  }
  if (booking.status !== "booked") {
    throw new AppError(`A ${booking.status} booking cannot be approved`, 400);
  }

  booking.status = "approved";
  await booking.save();
  return booking;
};

// The customer, the venue owner, or an admin can cancel an upcoming booking
const cancelBooking = async (bookingId, user) => {
  const booking = await findBookingWithVenue(bookingId);

  const isCustomer = booking.customer.toString() === user._id.toString();
  const isAdmin = user.role === "Admin";
  if (!isCustomer && !isAdmin && !isVenueOwner(booking, user._id)) {
    throw new AppError("You do not have permission to modify this booking.", 403);
  }
  if (!["pending_payment", "booked", "approved"].includes(booking.status)) {
    throw new AppError(`A ${booking.status} booking cannot be cancelled`, 400);
  }
  if (!isAdmin && booking.startTime.getTime() <= Date.now()) {
    throw new AppError("Past or ongoing bookings cannot be cancelled", 400);
  }

  booking.status = "cancelled";
  await booking.save();
  return booking;
};

/* ========================
   AGGREGATIONS & COUNTS
======================== */
const getCustomerBookings = async (customerId) => {
  return await Booking.find({ customer: customerId }).populate("venue", "venueName location venueImages");
};

const getCustomerBookingCount = async (customerId) => {
  return await Booking.countDocuments({ customer: customerId });
};

const getTotalBookingsForOwner = async (ownerId) => {
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id");
  return await Booking.countDocuments({
    venue: { $in: ownerVenues.map((v) => v._id) },
    status: { $in: ["booked", "approved", "completed"] },
  });
};

const getGlobalTotalBookings = async () => {
  return await Booking.countDocuments();
};

const getTopVenuesByBooking = async () => {
  return await Booking.aggregate([
    { $match: { status: { $in: ["booked", "approved", "completed"] } } },
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
      $project: {
        _id: 0,
        venueId: "$venueDetails._id",
        venueName: "$venueDetails.venueName",
        location: "$venueDetails.location",
        averageRating: "$venueDetails.averageRating",
        pricePerHour: "$venueDetails.pricePerHour",
        bookingCount: 1,
      },
    },
  ]);
};

module.exports = {
  createBooking,
  getBookingsForOwner,
  getMonthlyEarningsForOwner,
  approveBooking,
  cancelBooking,
  getCustomerBookings,
  getCustomerBookingCount,
  getTotalBookingsForOwner,
  getGlobalTotalBookings,
  getTopVenuesByBooking,
};
