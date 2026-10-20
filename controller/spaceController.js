const asyncHandler = require("../utils/asyncHandler");
const spaceService = require("../services/spaceService");

exports.createSpace = asyncHandler(async (req, res) => {
  const space = await spaceService.createSpace(req.params.venueId, req.user._id, req.body);

  res.status(201).json({
    success: true,
    message: "Space created successfully",
    data: space,
  });
});

exports.getSpacesForVenue = asyncHandler(async (req, res) => {
  const spaces = await spaceService.getSpacesForVenue(req.params.venueId);

  res.status(200).json({
    success: true,
    data: spaces,
  });
});

exports.assertCanAddImages = asyncHandler(async (req, res, next) => {
  await spaceService.assertCanAddImages(req.params.id, req.user._id);
  next();
});

exports.addImages = asyncHandler(async (req, res) => {
  const space = await spaceService.addSpaceImages(req.params.id, req.user._id, req.files);
  res.status(201).json({ success: true, message: "Photos added", data: space });
});

exports.removeImage = asyncHandler(async (req, res) => {
  const space = await spaceService.removeSpaceImage(req.params.id, req.user._id, req.body.filename);
  res.status(200).json({ success: true, message: "Photo removed", data: space });
});

exports.updateSpace = asyncHandler(async (req, res) => {
  const space = await spaceService.updateSpace(req.params.id, req.user._id, req.body);

  res.status(200).json({
    success: true,
    message: "Space updated successfully",
    data: space,
  });
});

exports.deactivateSpace = asyncHandler(async (req, res) => {
  await spaceService.deactivateSpace(req.params.id, req.user._id);

  res.status(200).json({
    success: true,
    message: "Space removed successfully",
  });
});
