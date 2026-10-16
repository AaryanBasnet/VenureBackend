const asyncHandler = require("../utils/asyncHandler");
const landingService = require("../services/landingService");

exports.getLanding = asyncHandler(async (req, res) => {
  const payload = await landingService.getLanding();
  // Express adds a weak ETag, so repeat visits get a 304 once the minute is up
  res.set("Cache-Control", "public, max-age=60");
  res.status(200).json({ success: true, data: payload });
});

exports.updateLanding = asyncHandler(async (req, res) => {
  const payload = await landingService.updateLanding(req.body, req.user._id);
  res.status(200).json({ success: true, message: "Home page content updated.", data: payload });
});
