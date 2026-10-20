const Venue = require("../model/venue");
const Space = require("../model/space");
const Booking = require("../model/booking");
const Notification = require("../model/notification"); // Standardized capitalization
const AppError = require("../utils/AppError");
const { cloudinary } = require("../middleware/uploadMiddleware");
const logger = require("../utils/logger");
const escapeRegex = require("../utils/escapeRegex");

const VENUE_STATUSES = ["pending", "approved", "rejected"];
const MAX_PAGE_SIZE = 50;

const toPaging = (filters) => {
  const page = Math.max(parseInt(filters.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(filters.limit) || 10, 1), MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit };
};

/* ========================
   FILE STORAGE ABSTRACTION
======================== */
const deleteExternalImages = async (images = []) => {
  try {
    const deletePromises = images.map((img) => 
      cloudinary.uploader.destroy(img.filename) 
    );
    await Promise.all(deletePromises);
  } catch (err) {
    logger.error({ message: "Failed to delete images from Cloudinary", error: err.message });
  }
};

/* ========================
   OWNER ACTIONS
======================== */
const createVenue = async (venueData, ownerId) => {
  let geoCoordinates = undefined;
  if (venueData.geoCoordinates) {
    geoCoordinates = {
      type: "Point",
      coordinates: [venueData.geoCoordinates.longitude, venueData.geoCoordinates.latitude],
    };
  }

  const venue = await Venue.create({
    ...venueData,
    geoCoordinates,
    owner: ownerId,
  });

  return venue;
};

const updateVenueImages = async (venueId, ownerId, files) => {
  const venue = await Venue.findOne({ _id: venueId, owner: ownerId, isDeleted: false });
  if (!venue) {
    // Don't keep images uploaded for a venue the caller doesn't own
    await deleteExternalImages(files.map((file) => ({ filename: file.filename || file.public_id })));
    throw new AppError("Venue not found or unauthorized", 404);
  }

  const newImages = files.map((file) => ({
    filename: file.filename || file.public_id, 
    url: file.path || file.secure_url,
  }));

  venue.venueImages.push(...newImages);
  await venue.save();
  return venue;
};

const updateVenue = async (venueId, ownerId, updateData, files) => {
  const venue = await Venue.findOne({ _id: venueId, owner: ownerId, isDeleted: false });
  if (!venue) {
    if (files?.length) {
      await deleteExternalImages(files.map((file) => ({ filename: file.filename || file.public_id })));
    }
    throw new AppError("Venue not found or unauthorized", 404);
  }

  // Safely format new GeoCoordinates if they were updated
  if (updateData.geoCoordinates) {
    venue.geoCoordinates = {
      type: "Point",
      coordinates: [updateData.geoCoordinates.longitude, updateData.geoCoordinates.latitude],
    };
    delete updateData.geoCoordinates; // Remove so Object.assign doesn't mess it up
  }

  // Update remaining text fields
  Object.assign(venue, updateData);

  // If new images were uploaded during the update, append them
  if (files && files.length > 0) {
    const newImages = files.map((file) => ({
      filename: file.filename || file.public_id,
      url: file.path || file.secure_url,
    }));
    venue.venueImages.push(...newImages);
  }

  await venue.save();
  return venue;
};

const getVenuesByOwner = async (ownerId, filters = {}) => {
  const { page, limit, skip } = toPaging(filters);

  const query = { owner: ownerId, isDeleted: false };
  
  const [venues, total] = await Promise.all([
    Venue.find(query).select("-priceSortKey").sort("-createdAt").skip(skip).limit(limit).lean(),
    Venue.countDocuments(query),
  ]);

  return { venues, total, pages: Math.ceil(total / limit) };
};

const getApprovedVenueCountByOwner = async (ownerId) => {
  return await Venue.countDocuments({ owner: ownerId, status: "approved", isDeleted: false });
};

const softDeleteVenue = async (venueId, userId, userRole) => {
  // Check if they are the owner OR an Admin
  const query = { _id: venueId, isDeleted: false };
  if (userRole !== "Admin") {
    query.owner = userId;
  }

  const venue = await Venue.findOne(query);
  if (!venue) throw new AppError("Venue not found or unauthorized", 404);

  // Customers have paid deposits for these dates: the venue must cancel them (which refunds) before it can disappear
  const upcoming = await Booking.countDocuments({
    venue: venue._id,
    status: { $in: ["pending_deposit", "confirmed"] },
    endTime: { $gt: new Date() },
  });
  if (upcoming > 0) {
    throw new AppError(
      `This venue has ${upcoming} upcoming ${upcoming === 1 ? "booking" : "bookings"}. Cancel ${upcoming === 1 ? "it" : "them"} first, then delete the venue.`,
      409
    );
  }

  venue.isDeleted = true;
  await venue.save();
  
  return venue;
};


/* ========================
   USER / DISCOVERY
======================== */
// Venues no longer carry a capacity of their own: it lives on their spaces. Cards show the largest
// space and how many there are, so attach those to a list of (lean) venues.
const attachCapacity = async (venues) => {
  if (venues.length === 0) return venues;
  // Venues now carry maxCapacity/spaceCount themselves (kept up to date by hooks in model/space.js)
  if (venues.every((v) => v.maxCapacity !== undefined && v.spaceCount !== undefined)) return venues;
  const rows = await Space.aggregate([
    { $match: { venue: { $in: venues.map((v) => v._id) }, isActive: true } },
    { $group: { _id: "$venue", maxCapacity: { $max: "$capacity" }, spaceCount: { $sum: 1 } } },
  ]);
  const byVenue = new Map(rows.map((r) => [String(r._id), r]));
  return venues.map((v) => ({
    ...v,
    maxCapacity: byVenue.get(String(v._id))?.maxCapacity ?? 0,
    spaceCount: byVenue.get(String(v._id))?.spaceCount ?? 0,
  }));
};

// Sort orders for the public list. Every one ends in _id so pages never overlap. Venues without packages
// sort last for both price orders (priceSortKey is a huge number for them; minPricePerPlate is null).
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  rating: { averageRating: -1, totalReviews: -1, createdAt: -1, _id: -1 },
  popular: { totalReviews: -1, averageRating: -1, createdAt: -1, _id: -1 },
  price_asc: { priceSortKey: 1, createdAt: -1, _id: -1 },
  price_desc: { minPricePerPlate: -1, createdAt: -1, _id: -1 },
};

// Lists never ship drink options (detail-page only) or the internal sort key
const LIST_PROJECTION = "-drinkOptions -priceSortKey";

const getApprovedVenues = async (filters) => {
  const { search, city, category, spaceType, lng, lat, radius, guests, amenities, sort, minPrice, maxPrice } = filters;
  const { page, limit, skip } = toPaging(filters);
  const query = { status: "approved", isDeleted: false };

  if (search) query.venueName = { $regex: escapeRegex(search), $options: "i" };
  if (city) query["location.city"] = { $eq: String(city) };
  if (category) query.category = { $eq: String(category) };
  if (spaceType) query.spaceTypes = { $eq: String(spaceType) }; // some active space of this kind
  if (amenities) {
    const wanted = String(amenities).split(",").map((a) => a.trim()).filter(Boolean);
    if (wanted.length) query.amenities = { $all: wanted };
  }
  if (guests) query.maxCapacity = { $gte: Number(guests) };

  // Price: a venue matches when ANY of its packages costs between minPrice and maxPrice
  const hasMin = minPrice !== undefined && minPrice !== null && minPrice !== "";
  const hasMax = maxPrice !== undefined && maxPrice !== null && maxPrice !== "";
  if (hasMin || hasMax) {
    const range = {};
    if (hasMin) range.$gte = Number(minPrice);
    if (hasMax) range.$lte = Number(maxPrice);
    query.packages = { $elemMatch: { pricePerPlate: range } };
  }

  // MAPS INTEGRATION
  const nearby = lng && lat && radius;
  if (nearby) {
    // The 2dsphere index is on geoCoordinates.coordinates ([lng, lat]); a query on the parent object finds no usable index
    query["geoCoordinates.coordinates"] = {
      $near: {
        $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseFloat(radius) * 1609.34, // Miles to meters
      },
    };
  }

  // $near already orders by distance, so only apply a sort when no location was given.
  let find = Venue.find(query).select(LIST_PROJECTION).skip(skip).limit(limit);
  if (!nearby) find = find.sort(SORTS[sort] || SORTS.newest);
  // $near is not allowed in countDocuments: count the same circle with $geoWithin instead
  const countQuery = { ...query };
  if (nearby) {
    countQuery["geoCoordinates.coordinates"] = {
      $geoWithin: { $centerSphere: [[parseFloat(lng), parseFloat(lat)], (parseFloat(radius) * 1609.34) / 6378100] },
    };
  }
  const [venues, total] = await Promise.all([find.lean(), Venue.countDocuments(countQuery)]);

  return { venues, total, pages: Math.ceil(total / limit) };
};

// Which spaces are already taken between two dates (no personal details): used to grey out calendar days.
const AVAILABILITY_MAX_ROWS = 20000;
const getVenueAvailability = async (venueId, { from, to } = {}) => {
  if (typeof from !== "string" || typeof to !== "string") throw new AppError("Provide a valid from and to date", 400);
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError("Provide a valid from and to date", 400);
  }
  if ((end - start) / 86400000 > 93) throw new AppError("Ask for at most three months at a time", 400);

  const venue = await Venue.findOne({ _id: venueId, isDeleted: false, status: "approved" }).select("_id");
  if (!venue) throw new AppError("Venue not found", 404);

  const spaces = await Space.find({ venue: venueId, isActive: true }).select("_id");
  const { liveBookingFilter } = require("./slotService");
  // Capped as a safety net: a 93 day window cannot legitimately hold more shifts than this
  const bookings = await Booking.find({
    space: { $in: spaces.map((s) => s._id) },
    startTime: { $lt: end },
    endTime: { $gt: start },
    ...liveBookingFilter(),
  })
    .select("space startTime endTime")
    .sort({ startTime: 1 })
    .limit(AVAILABILITY_MAX_ROWS)
    .lean();

  return bookings.map((b) => ({ space: b.space, startTime: b.startTime, endTime: b.endTime }));
};

// How many approved venues there are of each venue type (category), and how many have each kind of space.
// A venue with two kinds of space counts once under each.
const getTypeCounts = async () => {
  const live = { status: "approved", isDeleted: false };
  const [categoryRows, spaceTypeRows] = await Promise.all([
    Venue.aggregate([{ $match: { ...live, category: { $ne: null } } }, { $group: { _id: "$category", count: { $sum: 1 } } }]),
    Venue.aggregate([{ $match: live }, { $unwind: "$spaceTypes" }, { $group: { _id: "$spaceTypes", count: { $sum: 1 } } }]),
  ]);
  const toMap = (rows) => rows.reduce((counts, row) => ({ ...counts, [row._id]: row.count }), {});
  return { categories: toMap(categoryRows), spaceTypes: toMap(spaceTypeRows) };
};

// Landing page "Our Finest Heritage Spaces": admin-curated picks
const getFeaturedVenues = async (limit = 3) => {
  const venues = await Venue.find({ isFeatured: true, status: "approved", isDeleted: false })
    .select(LIST_PROJECTION)
    .sort("-createdAt")
    .limit(limit)
    .lean();
  return attachCapacity(venues);
};

// Public venue page: only approved venues, and no owner contact details
const getVenueById = async (venueId) => {
  const venue = await Venue.findOne({ _id: venueId, isDeleted: false, status: "approved" })
    .select("-priceSortKey")
    .populate("owner", "name avatar")
    .lean();

  if (!venue) throw new AppError("Venue not found", 404);
  return venue;
};


/* ========================
   ADMIN ACTIONS
======================== */
const getAllVenues = async (filters = {}) => {
  const { page, limit, skip } = toPaging(filters);
  const search = filters.search || "";
  const status = filters.status;

  const query = { isDeleted: false };
  if (search) query.venueName = { $regex: escapeRegex(search), $options: "i" };
  if (VENUE_STATUSES.includes(status)) query.status = status;

  const [total, venues] = await Promise.all([
    Venue.countDocuments(query),
    Venue.find(query)
      .select(LIST_PROJECTION)
      .populate("owner", "name email")
      .sort("-createdAt")
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { venues, total, pages: Math.ceil(total / limit) };
};

const getApprovedVenueCount = async () => {
  return await Venue.countDocuments({ status: "approved", isDeleted: false });
};

const updateVenueStatus = async (venueId, status, io) => {
  if (!VENUE_STATUSES.includes(status)) {
    throw new AppError(`Status must be one of: ${VENUE_STATUSES.join(", ")}`, 400);
  }

  // A venue that is no longer approved cannot stay featured on the landing page
  const update = status === "approved" ? { status } : { status, isFeatured: false };
  const venue = await Venue.findOneAndUpdate(
    { _id: venueId, isDeleted: false },
    update,
    { new: true, runValidators: true }
  ).populate("owner", "name");
  if (!venue) throw new AppError("Venue not found", 404);

  if (venue.owner) {
    const notification = await Notification.create({
      recipient: venue.owner._id,
      type: "approval",
      message: `Your venue "${venue.venueName}" has been ${status}.`,
    });
    if (io) io.to(venue.owner._id.toString()).emit("newNotification", notification);
  }

  return venue;
};

const toggleFeatured = async (venueId) => {
  const venue = await Venue.findOne({ _id: venueId, isDeleted: false });
  if (!venue) throw new AppError("Venue not found", 404);

  // Only a live venue can go on the landing page. Un-featuring is always allowed.
  if (!venue.isFeatured && venue.status !== "approved") {
    throw new AppError("Only approved venues can be featured", 400);
  }

  venue.isFeatured = !venue.isFeatured;
  await venue.save();

  return venue;
};

// Export ALL functions to satisfy the Controller
module.exports = {
  attachCapacity,
  createVenue,
  updateVenueImages,
  updateVenue,
  getVenuesByOwner,
  getApprovedVenueCountByOwner,
  softDeleteVenue,
  getApprovedVenues,
  getTypeCounts,
  getFeaturedVenues,
  getVenueById,
  getVenueAvailability,
  getAllVenues,
  getApprovedVenueCount,
  updateVenueStatus,
  toggleFeatured,
  deleteExternalImages
};