const { SHIFT_NAMES } = require("../model/space");
const AppError = require("../utils/AppError");

// Platform-standard shift hours. Owners can override per-space via Space.shiftOverrides.
const SHIFT_DEFAULTS = {
  day: { startTime: "10:00", endTime: "15:00" },
  night: { startTime: "17:00", endTime: "22:00" },
  full_day: { startTime: "10:00", endTime: "22:00" },
};

// Shift hours are Nepal time (UTC+5:45, no daylight saving) wherever the server runs: a host in UTC
// must still turn "10:00" into 10:00 in Kathmandu.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

const parseHHMM = (date, hhmm) => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  // The calendar day in Kathmandu that this instant falls on
  const nepalDay = new Date(new Date(date).getTime() + NEPAL_OFFSET_MS);
  const utcAtNepalClock = Date.UTC(nepalDay.getUTCFullYear(), nepalDay.getUTCMonth(), nepalDay.getUTCDate(), hours, minutes);
  return new Date(utcAtNepalClock - NEPAL_OFFSET_MS);
};

/**
 * Resolves {eventDate, shift, space} into real start/end Dates — the hand-off
 * point between the customer/owner-facing shift concept and the existing
 * Date-range-based overlap/race-safety logic, which needs no changes.
 */
const resolveShiftTimes = (eventDate, shift, space) => {
  if (!SHIFT_NAMES.includes(shift)) {
    throw new AppError(`Shift must be one of: ${SHIFT_NAMES.join(", ")}`, 400);
  }

  const override = space?.shiftOverrides?.find((o) => o.shift === shift);
  const { startTime, endTime } = override || SHIFT_DEFAULTS[shift];

  const start = parseHHMM(eventDate, startTime);
  const end = parseHHMM(eventDate, endTime);
  if (end <= start) {
    throw new AppError("Invalid shift hours configured for this space", 400);
  }

  return { startTime: start, endTime: end };
};

module.exports = { SHIFT_NAMES, SHIFT_DEFAULTS, resolveShiftTimes };
