const Space = require("../model/space");
const Venue = require("../model/venue");
const Booking = require("../model/booking");
const AppError = require("../utils/AppError");
const { SHIFT_DEFAULTS } = require("./shiftService");

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
  const spaces = await Space.find({ venue: venueId, isActive: true }).sort("name").lean(); // lean: read-only response
  return spaces.map(withResolvedShifts);
};

const deactivateSpace = async (spaceId, ownerId) => {
  const space = await Space.findById(spaceId).populate("venue", "owner status");
  if (!space || !space.venue || space.venue.owner.toString() !== ownerId.toString()) {
    throw new AppError("Space not found or unauthorized", 404);
  }

  // Only bookings that still have to happen block the removal: a hall that hosted events in the past
  // (completed or already over) must stay removable, same rule as deleting a venue.
  const hasActiveBookings = await Booking.exists({
    space: space._id,
    status: { $in: ["pending_deposit", "confirmed"] },
    endTime: { $gt: new Date() },
  });
  if (hasActiveBookings) {
    throw new AppError("This space has active bookings and cannot be removed", 409);
  }

  // A live venue needs at least one hall, or customers could never send it a request
  if (space.venue.status === "approved") {
    const otherActive = await Space.exists({ venue: space.venue._id, isActive: true, _id: { $ne: space._id } });
    if (!otherActive) {
      throw new AppError("A live venue needs at least one hall. Add another hall first, then remove this one.", 409);
    }
  }

  space.isActive = false;
  await space.save();
  return space;
};

/* ================= PHOTOS OF A HALL ================= */

const { cloudinary, SPACE_IMAGE_MAX } = require("../middleware/uploadMiddleware");
const logger = require("../utils/logger");

const discard = (files) =>
  Promise.all(
    files.map((f) => cloudinary.uploader.destroy(f.filename || f.public_id).catch((e) => logger.warn(`Could not remove ${f.filename}: ${e.message}`)))
  );

// Checked before the upload, so a request that cannot succeed stores nothing
const assertCanAddImages = async (spaceId, ownerId) => {
  const space = await Space.findById(spaceId).populate("venue", "owner");
  if (!space || !space.isActive || !space.venue || String(space.venue.owner) !== String(ownerId)) {
    throw new AppError("Space not found or unauthorized", 404);
  }
  if (space.spaceImages.length >= SPACE_IMAGE_MAX) throw new AppError(`A hall can have up to ${SPACE_IMAGE_MAX} photos`, 400);
};

const addSpaceImages = async (spaceId, ownerId, files = []) => {
  if (!files.length) throw new AppError("Choose a photo to add", 400);
  const images = files.map((f) => ({ filename: f.filename || f.public_id, url: f.path || f.secure_url }));

  // One atomic step: the owner and the limit are re-checked at the moment of writing, so two uploads at once cannot go over
  const ownerVenues = await Venue.find({ owner: ownerId, isDeleted: false }).select("_id").lean();
  const space = await Space.findOneAndUpdate(
    {
      _id: { $eq: spaceId },
      isActive: true,
      venue: { $in: ownerVenues.map((v) => v._id) },
      $expr: { $lte: [{ $add: [{ $size: "$spaceImages" }, images.length] }, SPACE_IMAGE_MAX] },
    },
    { $push: { spaceImages: { $each: images } } },
    { new: true }
  );
  if (!space) {
    await discard(files);
    throw new AppError(`This hall cannot take more photos (up to ${SPACE_IMAGE_MAX})`, 409);
  }
  return withResolvedShifts(space);
};

const removeSpaceImage = async (spaceId, ownerId, filename) => {
  const ownerVenues = await Venue.find({ owner: ownerId, isDeleted: false }).select("_id").lean();
  const space = await Space.findOneAndUpdate(
    // Values from the request are compared as plain values ($eq), so an object can never act as a query operator
    { _id: { $eq: spaceId }, venue: { $in: ownerVenues.map((v) => v._id) }, "spaceImages.filename": { $eq: String(filename) } },
    { $pull: { spaceImages: { filename: { $eq: String(filename) } } } },
    { new: true }
  );
  if (!space) throw new AppError("Photo not found", 404);
  await discard([{ filename }]);
  return withResolvedShifts(space);
};

module.exports = {
  createSpace, updateSpace, getSpacesForVenue, deactivateSpace, withResolvedShifts,
  assertCanAddImages, addSpaceImages, removeSpaceImage,
};
