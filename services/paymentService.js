const crypto = require("crypto");
const Booking = require("../model/booking");
const Quotation = require("../model/quotation");
const PaymentAttempt = require("../model/paymentAttempt");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const esewa = require("../utils/esewa");

const ACTIVE_BOOKING_STATUSES = ["pending_deposit", "confirmed", "completed"];

const frontendBase = () => process.env.FRONTEND_URL.split(",")[0].trim().replace(/\/$/, "");

/**
 * Starts the deposit payment for an accepted quotation. Returns the signed form
 * the browser posts to eSewa. The booking is only created after eSewa sends the
 * customer back and verifyEsewaDeposit has proven the payment.
 */
const initiateDeposit = async ({ quotationId }, userId) => {
  const quotation = await Quotation.findById(quotationId).populate("inquiry", "customer");
  if (!quotation) throw new AppError("Quotation not found", 404);
  if (quotation.inquiry.customer.toString() !== userId.toString()) {
    throw new AppError("You do not have permission to pay for this quotation.", 403);
  }
  if (quotation.status !== "accepted") {
    throw new AppError("This quotation must be accepted before paying the deposit", 400);
  }
  if (quotation.startTime <= new Date()) {
    throw new AppError("This event date has already passed", 400);
  }

  // Soft pre-check only; the authoritative race defense is the insert-first
  // claim in bookingService.createBookingFromQuotation.
  const conflict = await Booking.findOne({
    space: quotation.space,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startTime: { $lt: quotation.endTime },
    endTime: { $gt: quotation.startTime },
  });
  if (conflict) throw new AppError("This space is already booked during this time slot", 409);

  return buildEsewaForm(quotation, userId);
};

const buildEsewaForm = async (quotation, userId) => {
  let config;
  try {
    config = esewa.getConfig();
  } catch (err) {
    logger.error(err.message);
    throw new AppError("eSewa payments are not available right now", 503);
  }

  const amount = quotation.depositAmount;
  const transactionUuid = `VN-${Date.now()}-${crypto.randomInt(100000, 999999)}`;
  await PaymentAttempt.create({
    quotation: quotation._id,
    customer: userId,
    transactionUuid,
    amountNPR: amount,
  });

  const signedFieldNames = "total_amount,transaction_uuid,product_code";
  const fields = {
    amount,
    tax_amount: 0,
    total_amount: amount,
    transaction_uuid: transactionUuid,
    product_code: config.merchantCode,
    product_service_charge: 0,
    product_delivery_charge: 0,
    success_url: `${frontendBase()}/payment/esewa/success`,
    failure_url: `${frontendBase()}/payment/esewa/failure`,
    signed_field_names: signedFieldNames,
  };
  fields.signature = esewa.sign(fields, signedFieldNames, config.secretKey);

  return {
    provider: "esewa",
    formUrl: config.formUrl,
    formData: fields,
    transactionUuid,
    amount,
  };
};

/**
 * Proves the redirect from eSewa is genuine and the deposit was paid:
 *  1. the signature on the callback is valid,
 *  2. it matches an attempt we started for this customer, for the amount we set,
 *  3. eSewa itself reports the payment as COMPLETE.
 * Returns the verified payment details; it creates no booking.
 */
const verifyEsewaDeposit = async (encoded, userId) => {
  const body = esewa.decodeCallback(encoded);
  if (!body) throw new AppError("This payment confirmation could not be verified.", 400);

  const attempt = await PaymentAttempt.findOne({ transactionUuid: body.transaction_uuid });
  if (!attempt || attempt.customer.toString() !== userId.toString()) {
    throw new AppError("Payment not found for this account.", 404);
  }
  if (Number(String(body.total_amount).replace(/,/g, "")) !== attempt.amountNPR) {
    throw new AppError("Payment does not match this booking.", 400);
  }
  if (body.status !== "COMPLETE") {
    attempt.status = "failed";
    await attempt.save();
    throw new AppError("The eSewa payment was not completed.", 400);
  }

  let remote;
  try {
    remote = await esewa.fetchStatus({ transactionUuid: attempt.transactionUuid, totalAmount: attempt.amountNPR });
  } catch (err) {
    logger.error({ message: "eSewa status check failed", transactionUuid: attempt.transactionUuid, error: err.message });
    throw new AppError("We could not confirm the payment with eSewa. Please try again in a moment.", 502);
  }
  if (remote.status !== "COMPLETE") {
    throw new AppError("eSewa has not confirmed this payment.", 400);
  }

  attempt.status = "completed";
  attempt.transactionCode = body.transaction_code || remote.ref_id;
  await attempt.save();

  return {
    quotationId: attempt.quotation,
    transactionId: attempt.transactionCode || attempt.transactionUuid,
    amountNPR: attempt.amountNPR,
  };
};

module.exports = { initiateDeposit, verifyEsewaDeposit, ACTIVE_BOOKING_STATUSES };
