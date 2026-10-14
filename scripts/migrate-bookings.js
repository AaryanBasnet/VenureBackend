// Backfills existing Bookings into the new Space/Inquiry/Quotation/Payment shape:
//   - space: resolved from the venue's migrated default Space (run migrate-spaces.js first)
//   - inquiry/quotation: left null — these bookings predate that flow, not fabricated
//   - depositAmount = totalPrice, balanceAmount = 0, balanceSettled = true — the full
//     amount was always collected upfront under the old model, so nothing is owed
//   - status mapped 1:1 into the new enum
//   - one Payment record created from the old embedded paymentDetails, which is then removed
// Idempotent — safe to re-run; skips bookings that already have a `space`.
//
// Usage: node scripts/migrate-bookings.js
require('dotenv').config();

const mongoose = require('mongoose');
const Space = require('../model/space.js');
const Payment = require('../model/payment.js');
const logger = require('../utils/logger');

const STATUS_MAP = {
  pending_payment: 'pending_deposit',
  booked: 'confirmed',
  approved: 'confirmed',
  cancelled: 'cancelled',
  completed: 'completed',
};

const run = async () => {
  await mongoose.connect(process.env.DB_URL);
  logger.info('migrate-bookings: connected to database');

  const bookingsCollection = mongoose.connection.collection('bookings');
  const bookings = await bookingsCollection.find({ space: { $exists: false } }).toArray();
  logger.info(`migrate-bookings: ${bookings.length} legacy bookings to migrate`);

  const defaultSpaces = await Space.find({ migratedFromVenue: true });
  const venueIdToSpaceId = Object.fromEntries(
    defaultSpaces.map((s) => [s.venue.toString(), s._id])
  );

  let migrated = 0;
  let skippedNoSpace = 0;

  for (const booking of bookings) {
    const spaceId = venueIdToSpaceId[booking.venue?.toString()];
    if (!spaceId) {
      logger.warn(`migrate-bookings: no migrated space for venue ${booking.venue}, skipping booking ${booking._id}`);
      skippedNoSpace += 1;
      continue;
    }

    const newStatus = STATUS_MAP[booking.status] || booking.status;

    await bookingsCollection.updateOne(
      { _id: booking._id },
      {
        $set: {
          space: spaceId,
          inquiry: null,
          quotation: null,
          eventDate: booking.startTime,
          shift: null, // legacy bookings predate the shift model
          depositAmount: booking.totalPrice,
          balanceAmount: 0,
          balanceSettled: true,
          cancellationPolicy: [],
          status: newStatus,
        },
        $unset: { paymentDetails: '', holdExpiresAt: '' },
      }
    );

    if (booking.paymentDetails?.transactionId) {
      await Payment.findOneAndUpdate(
        { transactionId: booking.paymentDetails.transactionId },
        {
          booking: booking._id,
          type: 'deposit',
          provider: booking.paymentDetails.provider || 'stripe',
          transactionId: booking.paymentDetails.transactionId,
          amountReceived: booking.paymentDetails.amountReceived,
          currency: booking.paymentDetails.currency || 'usd',
          amountNPR: booking.totalPrice,
          exchangeRateUsed: Number(process.env.USD_NPR_RATE) || 132, // unknown historically; best-effort
          status: booking.paymentDetails.status,
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    migrated += 1;
  }

  logger.info(`migrate-bookings: done — ${migrated} migrated, ${skippedNoSpace} skipped (no matching space)`);
};

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error({ message: 'migrate-bookings failed', error: error.message });
      process.exit(1);
    });
}

module.exports = { run };
