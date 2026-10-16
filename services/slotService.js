const Booking = require("../model/booking");
const { slotKeysFor } = require("../utils/slotKeys");

// A booking holds its slot while it is pending (a claim being confirmed), confirmed, or completed.
const ACTIVE_BOOKING_STATUSES = ["pending_deposit", "confirmed", "completed"];

// MongoDB's TTL monitor only runs about once a minute, so an expired claim can still be in the
// collection. Expiry is therefore enforced here, in every query that asks "is this slot taken?".
const liveBookingFilter = (now = new Date()) => ({
  $or: [
    { status: { $in: ["confirmed", "completed"] } },
    // $not/$lte also matches a claim with no expiry set, which must keep blocking
    { status: "pending_deposit", holdClaimExpiresAt: { $not: { $lte: now } } },
  ],
});

// Bookings that overlap [startTime, endTime) in a space: start < otherEnd and end > otherStart.
// Touching ranges (one ends exactly when the next starts) do not overlap.
const overlappingQuery = ({ space, startTime, endTime, excludeId = null, now = new Date() }) => ({
  space,
  startTime: { $lt: endTime },
  endTime: { $gt: startTime },
  ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  ...liveBookingFilter(now),
});

const findConflict = ({ space, startTime, endTime, excludeId, now }) =>
  Booking.exists(overlappingQuery({ space, startTime, endTime, excludeId, now }));

// Removes expired claims that overlap a slot, so they stop blocking it before the TTL monitor gets to them.
// Returns the removed claims so their orphaned payments can be cleaned up by the caller.
const purgeExpiredClaims = async ({ space, startTime, endTime, now = new Date() }) => {
  const stale = await Booking.find({
    space,
    status: "pending_deposit",
    holdClaimExpiresAt: { $lte: now },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  }).select("_id");
  if (stale.length) await Booking.deleteMany({ _id: { $in: stale.map((b) => b._id) }, status: "pending_deposit" });
  return stale;
};

// One-off for databases that already hold bookings: gives every active booking that has none its minute keys, so the
// unique index protects it too. Returns { updated, skipped, conflicts }: `conflicts` lists bookings that already
// overlap another active one (existing double bookings, which a person has to resolve), `skipped` those whose
// times are not on whole minutes (they stay protected by the query check only).
const backfillSlotKeys = async () => {
  const result = { updated: 0, skipped: 0, conflicts: [] };
  const cursor = Booking.find({ status: { $in: ACTIVE_BOOKING_STATUSES }, slotKeys: { $exists: false } }).select("space startTime endTime").cursor();
  for await (const booking of cursor) {
    const keys = slotKeysFor(booking.space, booking.startTime, booking.endTime);
    if (!keys) {
      result.skipped++;
      continue;
    }
    try {
      await Booking.collection.updateOne({ _id: booking._id }, { $set: { slotKeys: keys } });
      result.updated++;
    } catch (error) {
      if (error.code !== 11000) throw error;
      result.conflicts.push(String(booking._id));
    }
  }
  return result;
};

module.exports = {
  backfillSlotKeys, ACTIVE_BOOKING_STATUSES, liveBookingFilter, overlappingQuery, findConflict, purgeExpiredClaims };
