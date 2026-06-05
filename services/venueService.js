const Venue = require("../model/venue");
const Notification = require("../model/notification"); // Standardized capitalization
const AppError = require("../utils/AppError");
const { cloudinary } = require("../middleware/uploadMiddleware");
const logger = require("../utils/logger");

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

const updateVenueImages = async (venueId, files) => {
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);

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
  if (!venue) throw new AppError("Venue not found or unauthorized", 404);

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
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const skip = (page - 1) * limit;

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
  const { search, city, lng, lat, radius, page = 1, limit = 10 } = filters;
  const query = { status: "approved", isDeleted: false };

  if (search) query.venueName = { $regex: search, $options: "i" };
  if (city) query["location.city"] = city;

  // MAPS INTEGRATION
  if (lng && lat && radius) {
    query.geoCoordinates = {
      $near: {
        $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseFloat(radius) * 1609.34, // Miles to meters
      },
    };
  }

  const skip = (page - 1) * limit;
  const total = await Venue.countDocuments(query);
  const venues = await Venue.find(query).skip(skip).limit(limit).lean();

  return { venues, total, pages: Math.ceil(total / limit) };
};

const getVenueById = async (venueId) => {
  const venue = await Venue.findOne({ _id: venueId, isDeleted: false })
    .populate("owner", "name email avatar");
    
  if (!venue) throw new AppError("Venue not found", 404);
  return venue;
};


/* ========================
   ADMIN ACTIONS
======================== */
const getAllVenues = async (filters = {}) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const search = filters.search || "";
  const status = filters.status;

  const query = { isDeleted: false };
  if (search) query.venueName = { $regex: search, $options: "i" };
  if (status) query.status = status;

  const skip = (page - 1) * limit;
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
  const venue = await Venue.findByIdAndUpdate(venueId, { status }, { new: true }).populate("owner");
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

// Export ALL functions to satisfy the Controller
module.exports = {
  createVenue,
  updateVenueImages,
  updateVenue,
  getVenuesByOwner,
  getApprovedVenueCountByOwner,
  softDeleteVenue,
  getApprovedVenues,
  getVenueById,
  getAllVenues,
  getApprovedVenueCount,
  updateVenueStatus,
  deleteExternalImages
};