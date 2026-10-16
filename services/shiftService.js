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

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// The calendar day an instant falls on in Kathmandu, as a Date whose UTC fields hold that day (no time zone of the host involved).
const nepalCalendarDay = (instant) => {
  const shifted = new Date(new Date(instant).getTime() + NEPAL_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

// The instant a Kathmandu calendar day begins (00:00 Nepal time).
const startOfNepalDay = (instant) => new Date(nepalCalendarDay(instant).getTime() - NEPAL_OFFSET_MS);

// Whole Kathmandu calendar days from `from` to `to` (positive when `to` is a later day).
const nepalDaysBetween = (from, to) => Math.round((nepalCalendarDay(to) - nepalCalendarDay(from)) / DAY_MS);

// Event dates can be booked up to the end of the month this many months from now (the date picker's horizon).
const MAX_MONTHS_AHEAD = 24;
const lastBookableDay = (now = new Date()) => {
  const today = nepalCalendarDay(now);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + MAX_MONTHS_AHEAD + 1, 0));
};

const parseHHMM = (date, hhmm) => {
  const match = typeof hhmm === "string" ? HHMM.exec(hhmm) : null;
  if (!match) throw new AppError("Invalid shift hours configured for this space", 400);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  // The calendar day in Kathmandu that this instant falls on
  const nepalDay = new Date(new Date(date).getTime() + NEPAL_OFFSET_MS);
  if (Number.isNaN(nepalDay.getTime())) throw new AppError("Invalid event date", 400);
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

module.exports = { SHIFT_NAMES, SHIFT_DEFAULTS, resolveShiftTimes, nepalCalendarDay, startOfNepalDay, nepalDaysBetween, lastBookableDay, MAX_MONTHS_AHEAD, NEPAL_OFFSET_MS };
