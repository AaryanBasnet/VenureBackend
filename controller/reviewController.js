const { isDemoAdmin } = require("../services/demoScope");
const asyncHandler = require("../utils/asyncHandler");
const reviewService = require("../services/reviewService");

/* ========================
   STANDARD REVIEW CONTROLLERS
======================== */
exports.addReview = asyncHandler(async (req, res) => {
  const { bookingId, ...payload } = req.body;
  const review = await reviewService.addReview(
    req.params.venueId,
    req.user._id,
    bookingId,
    payload
  );

  res.status(201).json({
    success: true,
    message: "Review added successfully",
    data: review,
  });
});

exports.getReviews = asyncHandler(async (req, res) => {
  const reviews = await reviewService.getVenueReviews(req.params.venueId, req.query);

  res.status(200).json({
    success: true,
    data: reviews,
  });
});

exports.getReviewsForOwnerVenues = asyncHandler(async (req, res) => {
  const reviews = await reviewService.getReviewsForOwnerVenues(req.user._id, req.query);

  res.status(200).json({
    success: true,
    data: reviews,
  });
});

exports.deleteReview = asyncHandler(async (req, res) => {
  await reviewService.deleteReview(
    req.params.reviewId,
    req.user._id,
    req.user.role
  );

  res.status(200).json({
    success: true,
    message: "Review deleted successfully",
  });
});

/* ========================
   TESTIMONIAL (FEATURED) CONTROLLERS
======================== */
exports.getFeaturedReviews = asyncHandler(async (req, res) => {
  const testimonials = await reviewService.getFeaturedReviews();

  res.status(200).json({
    success: true,
    data: testimonials,
  });
});

exports.toggleFeaturedStatus = asyncHandler(async (req, res) => {
  const review = await reviewService.toggleFeaturedStatus(req.params.reviewId);

  res.status(200).json({
    success: true,
    message: review.isFeatured ? "Review is now featured" : "Review removed from featured",
    data: review,
  });
});

exports.getAdminReviews = asyncHandler(async (req, res) => {
  const data = await reviewService.getAdminReviews(req.query, isDemoAdmin(req.user));

  res.status(200).json({
    success: true,
    data,
  });
});
