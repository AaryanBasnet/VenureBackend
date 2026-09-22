const crypto = require("crypto"); // Needed for eSewa HMAC signatures
const Booking = require("../model/booking");
const Venue = require("../model/venue");
const AppError = require("../utils/AppError");
const { getStripe } = require("../utils/stripe");
const { quoteBooking, nprToUsdCents } = require("./pricingService");

const ACTIVE_BOOKING_STATUSES = ["pending_payment", "booked", "approved", "completed"];

const initiatePayment = async (payload, userId) => {
  const { venueId, startTime, endTime, numberOfGuests, selectedAddons = [], provider } = payload;

  // 1. Fetch venue & build the trusted quote (validates time range, capacity, add-ons)
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);

  const quote = quoteBooking({ venue, startTime, endTime, numberOfGuests, addons: selectedAddons });

  // 2. Collision detection
  const conflict = await Booking.findOne({
    venue: venueId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startTime: { $lt: quote.end },
    endTime: { $gt: quote.start },
  });
  if (conflict) throw new AppError("This slot is already booked.", 409);

  // 3. Gateway router
  if (provider === "stripe") {
    return processStripePayment(quote, { userId, venueId, numberOfGuests });
  }
  if (provider === "esewa") {
    return processEsewaPayment(quote.totalPrice);
  }

  throw new AppError("Unsupported payment provider", 400);
};

/* =========================================================================
   STRIPE IMPLEMENTATION
========================================================================= */
const processStripePayment = async (quote, { userId, venueId, numberOfGuests }) => {
  const paymentIntent = await getStripe().paymentIntents.create({
    amount: nprToUsdCents(quote.totalPrice),
    currency: "usd",
    // Everything the booking step needs to prove this payment was made for this exact booking
    metadata: {
      userId: userId.toString(),
      venueId: venueId.toString(),
      startTime: quote.start.toISOString(),
      endTime: quote.end.toISOString(),
      numberOfGuests: String(numberOfGuests),
      addonIds: quote.selectedAddons.map((a) => a.id).join(","),
      amountNPR: String(quote.totalPrice),
    },
  });

  return {
    provider: "stripe",
    clientSecret: paymentIntent.client_secret,
    transactionId: paymentIntent.id,
    amount: quote.totalPrice,
  };
};

/* =========================================================================
   ESEWA IMPLEMENTATION (v2 ePay)
   NOTE: there is no verification callback yet, so eSewa payments cannot create bookings.
========================================================================= */
const processEsewaPayment = async (amountNPR) => {
  if (!process.env.ESEWA_SECRET_KEY || !process.env.ESEWA_MERCHANT_CODE) {
    throw new AppError("eSewa payments are not available yet", 400);
  }

  const transactionUuid = `TXN-${Date.now()}-${crypto.randomInt(10000)}`;
  const message = `total_amount=${amountNPR},transaction_uuid=${transactionUuid},product_code=${process.env.ESEWA_MERCHANT_CODE}`;

  const signature = crypto
    .createHmac("sha256", process.env.ESEWA_SECRET_KEY)
    .update(message)
    .digest("base64");

  return {
    provider: "esewa",
    formData: {
      amount: amountNPR,
      tax_amount: "0",
      total_amount: amountNPR,
      transaction_uuid: transactionUuid,
      product_code: process.env.ESEWA_MERCHANT_CODE,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: `${process.env.FRONTEND_URL}/payment/esewa/success`,
      failure_url: `${process.env.FRONTEND_URL}/payment/esewa/failure`,
      signed_field_names: "total_amount,transaction_uuid,product_code",
      signature,
    },
  };
};

module.exports = { initiatePayment, ACTIVE_BOOKING_STATUSES };
