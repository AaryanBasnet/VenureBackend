const asyncHandler = require("../utils/asyncHandler");
const newsletterService = require("../services/newsletterService");

exports.subscribe = asyncHandler(async (req, res) => {
  await newsletterService.subscribe(req.body.email);

  res.status(200).json({
    success: true,
    message: "You're subscribed.",
  });
});
