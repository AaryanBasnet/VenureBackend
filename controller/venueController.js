const asyncHandler = require("../utils/asyncHandler");
const venueService = require("../services/venueService");

/* ========================
   PUBLIC / USER CONTROLLERS
======================== */
exports.getAllApprovedVenues = asyncHandler(async (req, res) => {
  const result = await venueService.getApprovedVenues(req.query);

  res.status(200).json({
    success: true,
    data: result.venues,
    total: result.total,
    pages: result.pages,
  });
});

exports.getVenueById = asyncHandler(async (req, res) => {
  const venue = await venueService.getVenueById(req.params.id);
  
  res.status(200).json({
    success: true,
    data: venue,
  });
});

/* ========================
   VENUE OWNER CONTROLLERS
======================== */
exports.getVenuesByOwner = asyncHandler(async (req, res) => {
  const venues = await venueService.getVenuesByOwner(req.user._id, req.query);
  
  res.status(200).json({
    success: true,
    data: venues,
  });
});

exports.getApprovedVenueCountByOwner = asyncHandler(async (req, res) => {
  const count = await venueService.getApprovedVenueCountByOwner(req.user._id);
  
  res.status(200).json({
    success: true,
    data: { count },
  });
});

exports.createVenue = asyncHandler(async (req, res) => {
  // req.body is fully parsed and validated by Zod at this point
  const venue = await venueService.createVenue(req.body, req.user._id);
  
  res.status(201).json({
    success: true,
    message: "Venue created successfully",
    data: venue,
  });
});

exports.uploadVenueImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: "No images provided" });
  }

  const venue = await venueService.updateVenueImages(req.params.id, req.files);
  
  res.status(200).json({
    success: true,
    message: "Images uploaded successfully",
    data: venue,
  });
});

exports.updateVenue = asyncHandler(async (req, res) => {
  // Passes the ID, Owner ID (for security check), the text body, and any new images
  const venue = await venueService.updateVenue(req.params.id, req.user._id, req.body, req.files);
  
  res.status(200).json({
    success: true,
    message: "Venue updated successfully",
    data: venue,
  });
});

exports.deleteVenue = asyncHandler(async (req, res) => {
  await venueService.softDeleteVenue(req.params.id, req.user._id, req.user.role);
  
  res.status(200).json({
    success: true,
    message: "Venue removed successfully",
  });
});

/* ========================
   ADMIN CONTROLLERS
======================== */
exports.getAllVenues = asyncHandler(async (req, res) => {
  const result = await venueService.getAllVenues(req.query);
  
  res.status(200).json({
    success: true,
    ...result,
  });
});

exports.getApprovedVenueCount = asyncHandler(async (req, res) => {
  const count = await venueService.getApprovedVenueCount();
  
  res.status(200).json({
    success: true,
    data: { count },
  });
});

exports.updateVenueStatus = asyncHandler(async (req, res) => {
  // Pass socket instance to the service to emit real-time notifications
  const io = req.app.get("io");
  const venue = await venueService.updateVenueStatus(req.params.id, req.body.status, io);
  
  res.status(200).json({
    success: true,
    message: `Venue status updated to ${req.body.status}`,
    data: venue,
  });
});