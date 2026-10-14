const Space = require("../model/space");
const Venue = require("../model/venue");
const Booking = require("../model/booking");
const AppError = require("../utils/AppError");
const { SHIFT_DEFAULTS } = require("./shiftService");

const ACTIVE_BOOKING_STATUSES = require("./paymentService").ACTIVE_BOOKING_STATUSES;

// Merges owner overrides onto the platform defaults so callers never have to
// know about SHIFT_DEFAULTS themselves.
const withResolvedShifts = (space) => {
  const plain = space.toObject ? space.toObject() : space;
  const resolvedShifts = Object.fromEntries(
    Object.entries(SHIFT_DEFAULTS).map(([shift, defaults]) => {
      const override = plain.shiftOverrides?.find((o) => o.shift === shift);
      return [shift, override ? { startTime: override.startTime, endTime: override.endTime } : defaults];
    })
  );
  return { ...plain, resolvedShifts };
};

const assertOwnsVenue = async (venueId, ownerId) => {
  const venue = await Venue.findOne({ _id: venueId, owner: ownerId, isDeleted: false });
  if (!venue) throw new AppError("Venue not found or unauthorized", 404);
  return venue;
};

const createSpace = async (venueId, ownerId, spaceData) => {
  await assertOwnsVenue(venueId, ownerId);
  const space = await Space.create({ ...spaceData, venue: venueId });
  return withResolvedShifts(space);
};

const updateSpace = async (spaceId, ownerId, updateData) => {
  const space = await Space.findById(spaceId).populate("venue", "owner");
  if (!space || !space.venue || space.venue.owner.toString() !== ownerId.toString()) {
    throw new AppError("Space not found or unauthorized", 404);
  }

  Object.assign(space, updateData);
  await space.save();
  return withResolvedShifts(space);
};

const getSpacesForVenue = async (venueId) => {
  const spaces = await Space.find({ venue: venueId, isActive: true }).sort("name");
  return spaces.map(withResolvedShifts);
};

const deactivateSpace = async (spaceId, ownerId) => {
  const space = await Space.findById(spaceId).populate("venue", "owner");
  if (!space || !space.venue || space.venue.owner.toString() !== ownerId.toString()) {
    throw new AppError("Space not found or unauthorized", 404);
  }

  const hasActiveBookings = await Booking.exists({
    space: space._id,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  });
  if (hasActiveBookings) {
    throw new AppError("This space has active bookings and cannot be removed", 409);
  }

  space.isActive = false;
  await space.save();
  return space;
};

module.exports = { createSpace, updateSpace, getSpacesForVenue, deactivateSpace, withResolvedShifts };
