const Stripe = require("stripe");
const crypto = require("crypto"); // Needed for eSewa HMAC signatures
const Booking = require("../model/booking");
const Venue = require("../model/venue");
const AppError = require("../utils/AppError");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Centralized price calculation (Never trust the frontend!)
const calculateExactPrice = (venue, start, end, guests, addons = []) => {
  const hoursBooked = Math.ceil((end - start) / (1000 * 60 * 60));
  let basePrice = hoursBooked * venue.pricePerHour;

  let addonsPrice = 0;
  addons.forEach((addon) => {
    addonsPrice += addon.perPerson ? addon.price * guests : addon.price;
  });

  return basePrice + addonsPrice; // Assuming NPR is your base currency
};

const initiatePayment = async (payload, userId) => {
  const { venueId, startTime, endTime, numberOfGuests, selectedAddons, provider } = payload;
  const start = new Date(startTime);
  const end = new Date(endTime);

  // 1. Fetch Venue & Calculate Secure Price
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);

  const exactAmountNPR = calculateExactPrice(venue, start, end, numberOfGuests, selectedAddons);

  // 2. Collision Detection
  const conflict = await Booking.findOne({
    venue: venueId,
    status: { $in: ["booked", "approved", "completed"] },
    $and: [{ startTime: { $lt: end } }, { endTime: { $gt: start } }],
  });

  if (conflict) {
    throw new AppError("This slot is already booked.", 409);
  }

  // 3. GATEWAY ROUTER (Strategy Pattern)
  if (provider === "stripe") {
    return await processStripePayment(exactAmountNPR, payload);
  } 
  
  if (provider === "esewa") {
    return await processEsewaPayment(exactAmountNPR, payload);
  }

  throw new AppError("Unsupported payment provider", 400);
};

/* =========================================================================
   STRIPE IMPLEMENTATION
========================================================================= */
const processStripePayment = async (amountNPR, metadata) => {
  // Configurable exchange rate (in a real app, fetch this from an API or DB)
  const EXCHANGE_RATE = process.env.USD_NPR_RATE || 132; 
  const amountUsdCents = Math.round((amountNPR / EXCHANGE_RATE) * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountUsdCents,
    currency: "usd",
    metadata: {
      venueId: metadata.venueId,
      startTime: metadata.startTime,
      endTime: metadata.endTime,
    },
  });

  return {
    provider: "stripe",
    clientSecret: paymentIntent.client_secret,
    transactionId: paymentIntent.id,
    amount: amountNPR,
  };
};

/* =========================================================================
   ESEWA IMPLEMENTATION (v2 ePay)
========================================================================= */
const processEsewaPayment = async (amountNPR, metadata) => {
  // eSewa requires a unique transaction UUID for every request
  const transactionUuid = `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  
  const message = `total_amount=${amountNPR},transaction_uuid=${transactionUuid},product_code=${process.env.ESEWA_MERCHANT_CODE}`;
  
  // eSewa v2 uses HMAC SHA256 Signature
  const signature = crypto
    .createHmac("sha256", process.env.ESEWA_SECRET_KEY)
    .update(message)
    .digest("base64");

  return {
    provider: "esewa",
    // We return the payload the frontend needs to submit the eSewa form
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
      signature: signature,
    }
  };
};

module.exports = { initiatePayment, calculateExactPrice };