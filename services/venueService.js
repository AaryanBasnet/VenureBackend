const Venue = require("../model/venue");
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
  
  const venues = await Venue.find(query).skip(skip).limit(limit).sort("-createdAt");
  const total = await Venue.countDocuments(query);

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

  venue.isDeleted = true;
  await venue.save();
  
  return venue;
};


/* ========================
   USER / DISCOVERY
======================== */
const getApprovedVenues = async (filters) => {
  const { search, city, category, lng, lat, radius } = filters;
  const { page, limit, skip } = toPaging(filters);
  const query = { status: "approved", isDeleted: false };

  if (search) query.venueName = { $regex: escapeRegex(search), $options: "i" };
  if (city) query["location.city"] = String(city);
  if (category) query.category = category;

  // MAPS INTEGRATION
  if (lng && lat && radius) {
    query.geoCoordinates = {
      $near: {
        $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseFloat(radius) * 1609.34, // Miles to meters
      },
    };
  }

  const total = await Venue.countDocuments(query);
  const venues = await Venue.find(query).skip(skip).limit(limit).lean();

  return { venues, total, pages: Math.ceil(total / limit) };
};

// Landing page venue-type cards: how many approved venues exist per category
const getCategoryCounts = async () => {
  const rows = await Venue.aggregate([
    { $match: { status: "approved", isDeleted: false, category: { $ne: null } } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  return rows.reduce((counts, row) => {
    counts[row._id] = row.count;
    return counts;
  }, {});
};

// Landing page "Our Finest Heritage Spaces": admin-curated picks
const getFeaturedVenues = async (limit = 3) => {
  return await Venue.find({ isFeatured: true, status: "approved", isDeleted: false })
    .sort("-createdAt")
    .limit(limit)
    .lean();
};

// Public venue page: only approved venues, and no owner contact details
const getVenueById = async (venueId) => {
  const venue = await Venue.findOne({ _id: venueId, isDeleted: false, status: "approved" })
    .populate("owner", "name avatar");

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

  const total = await Venue.countDocuments(query);
  const venues = await Venue.find(query)
    .populate("owner", "name email")
    .skip(skip)
    .limit(limit)
    .sort("-createdAt")
    .lean();

  return { venues, total, pages: Math.ceil(total / limit) };
};

const getApprovedVenueCount = async () => {
  return await Venue.countDocuments({ status: "approved", isDeleted: false });
};

const updateVenueStatus = async (venueId, status, io) => {
  if (!VENUE_STATUSES.includes(status)) {
    throw new AppError(`Status must be one of: ${VENUE_STATUSES.join(", ")}`, 400);
  }

  const venue = await Venue.findOneAndUpdate(
    { _id: venueId, isDeleted: false },
    { status },
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

  venue.isFeatured = !venue.isFeatured;
  await venue.save();

  return venue;
};

// Export ALL functions to satisfy the Controller
module.exports = {
  createVenue,
  updateVenueImages,
  updateVenue,
  getVenuesByOwner,
  getApprovedVenueCountByOwner,
  softDeleteVenue,
  getApprovedVenues,
  getCategoryCounts,
  getFeaturedVenues,
  getVenueById,
  getAllVenues,
  getApprovedVenueCount,
  updateVenueStatus,
  toggleFeatured,
  deleteExternalImages
};