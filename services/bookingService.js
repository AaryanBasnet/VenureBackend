const mongoose = require("mongoose");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const Booking = require("../model/Booking");
const Venue = require("../model/Venue");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");

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
    totalPrice: frontendPrice, // Used only to check against our internal math
    paymentIntentId,
    paymentDetails
  } = bookingData;

  const start = new Date(startTime);
  const end = new Date(endTime);

  // 1. Fetch Venue & Validate Capacity
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);
  if (venue.status !== "approved") throw new AppError("Venue is not currently available", 400);
  if (numberOfGuests > venue.capacity) throw new AppError(`Maximum capacity is ${venue.capacity}`, 400);

  // 2. Enterprise Security: Recalculate Price (Never trust frontend totals)
  const hoursBooked = Math.ceil((end - start) / (1000 * 60 * 60));
  let calculatedBasePrice = hoursBooked * venue.pricePerHour;
  
  let calculatedAddonsPrice = 0;
  selectedAddons.forEach((addon) => {
    calculatedAddonsPrice += addon.perPerson ? addon.price * numberOfGuests : addon.price;
  });

  const exactTotalPrice = calculatedBasePrice + calculatedAddonsPrice;
  if (Math.abs(exactTotalPrice - frontendPrice) > 1) { // Allowing 1 dollar/cent floating point tolerance
    logger.warn(`Price manipulation attempt by User ${customerId}`);
    throw new AppError("Price mismatch detected. Booking rejected.", 400);
  }

  // 3. Collision Detection
  const overlappingBooking = await Booking.findOne({
    venue: venueId,
    status: { $in: ["booked", "pending_payment", "approved", "completed"] },
    $and: [{ startTime: { $lt: end } }, { endTime: { $gt: start } }],
  });

  if (overlappingBooking) {
    throw new AppError("The venue is already booked during this time slot", 409);
  }

  // 4. Verify Stripe Payment
  const finalPaymentIntentId = paymentIntentId || (paymentDetails && paymentDetails.paymentIntentId);
  if (!finalPaymentIntentId) throw new AppError("Payment intent ID is missing", 400);

  const paymentIntent = await stripe.paymentIntents.retrieve(finalPaymentIntentId);
  if (paymentIntent.status !== "succeeded") {
    throw new AppError("Payment has not been successfully completed", 400);
  }

  // 5. Database Transaction (ACID Compliance)
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const newBooking = await Booking.create(
      [{
        ...bookingData,
        customer: customerId,
        startTime: start,
        endTime: end,
        totalPrice: exactTotalPrice, // Use our trusted math
        paymentDetails: {
          paymentIntentId: paymentIntent.id,
          amountReceived: paymentIntent.amount_received,
          paymentMethod: paymentIntent.payment_method,
          status: paymentIntent.status,
        },
        status: "booked",
      }],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return newBooking[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Booking transaction failed:", error);
    
    // In a fully scaled enterprise app, you would trigger a Stripe refund web-hook here
    throw new AppError("Critical database failure during booking. Please contact support.", 500);
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
const modifyBookingStatus = async (bookingId, newStatus) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new AppError("Booking not found", 404);

  booking.status = newStatus;
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
  modifyBookingStatus,
  getCustomerBookings,
  getCustomerBookingCount,
  getTotalBookingsForOwner,
  getGlobalTotalBookings,
  getTopVenuesByBooking,
};