// A database-level guard against double booking.
//
// Every shift-based booking holds one key per minute it occupies, "<spaceId>:<minutes since epoch>",
// for the half-open range [start, end). A unique index over those keys (see model/booking.js) means MongoDB
// itself refuses a second active booking that shares even one minute of the same space: it is a real
// overlap constraint, not only an exact-match one. Two bookings that only touch (one ends at 15:00, the
// next starts at 15:00) share no key, so back-to-back shifts stay legal.
//
// Only bookings whose start and end fall on whole minutes get keys (shift hours always do: they are
// "HH:mm"). Anything else is left to the query-based check in bookingService.

const MINUTE_MS = 60 * 1000;
// Longest span that gets keys: a bit over a day. A longer range is not a shift and is checked by query only.
const MAX_KEYED_MINUTES = 26 * 60;

const slotKeysFor = (space, startTime, endTime) => {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!space || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (start % MINUTE_MS !== 0 || end % MINUTE_MS !== 0) return null;
  const minutes = (end - start) / MINUTE_MS;
  if (minutes > MAX_KEYED_MINUTES) return null;

  const first = start / MINUTE_MS;
  const prefix = String(space);
  return Array.from({ length: minutes }, (_, i) => `${prefix}:${first + i}`);
};

module.exports = { slotKeysFor, MINUTE_MS };
