const Review = require("../model/review"); 
const Venue = require("../model/venue");   
const Booking = require("../model/booking");
const User = require("../model/user");
const AppError = require("../utils/AppError");

/* ========================
   CREATE / VERIFY
======================== */
const addReview = async (venueId, userId, bookingId, payload) => {
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);

  // 1. Did this user actually complete this specific booking at this venue?
  const booking = await Booking.findOne({
    _id: bookingId,
    venue: venueId,
    customer: userId,
    status: "completed",
  });
  if (!booking) {
    throw new AppError("You can only review a venue after a completed booking there.", 403);
  }

  // 2. Prevent duplicate reviews for the same booking (one booking, one review —
  // a customer who books the same venue twice may leave two honest reviews)
  const existingReview = await Review.findOne({ booking: bookingId, user: userId });
  if (existingReview) {
    throw new AppError("You have already reviewed this booking", 400);
  }

  // 3. Create the review (Mongoose post-save hook will auto-update the venue's average)
  const review = await Review.create({
    venue: venueId,
    booking: bookingId,
    user: userId,
    ...payload,
  });

  return review;
};

/* ========================
   FETCH REVIEWS
======================== */
const getVenueReviews = async (venueId) => {
  // Public endpoint: never expose reviewer emails
  return await Review.find({ venue: venueId })
    .populate("user", "name avatar")
    .sort("-createdAt"); // Newest first
};

const getReviewsForOwnerVenues = async (ownerId) => {
  // 1. Get all venues owned by this user
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id venueName");
  const venueIds = ownerVenues.map((v) => v._id);

  // 2. Find all reviews linked to those specific venues
  const reviews = await Review.find({ venue: { $in: venueIds } })
    .populate("user", "name avatar")
    .populate("venue", "venueName")
    .sort("-createdAt");

  return reviews;
};

/* ========================
   DELETE REVIEW
======================== */
const deleteReview = async (reviewId, userId, userRole) => {
  const review = await Review.findById(reviewId);
  if (!review) throw new AppError("Review not found", 404);

  // Only the user who wrote it OR an Admin can delete it. Venue owners cannot delete bad reviews!
  if (review.user.toString() !== userId.toString() && userRole !== "Admin") {
    throw new AppError("You are not authorized to delete this review", 403);
  }

  const venueId = review.venue;
  await review.deleteOne();

  // Manually trigger the static recalculation after deletion to ensure accuracy
  await Review.calculateAverageRating(venueId);
};

/* ========================
   TESTIMONIALS (FEATURED REVIEWS)
======================== */
const getFeaturedReviews = async () => {
  // Pulls only featured reviews with high ratings for the public landing page
  return await Review.find({ isFeatured: true, rating: { $gte: 4 } })
    .sort("-createdAt")
    .limit(5)
    .populate("user", "name avatar")
    .populate("venue", "venueName location");
};

const toggleFeaturedStatus = async (reviewId) => {
  const review = await Review.findById(reviewId);
  if (!review) throw new AppError("Review not found", 404);

  review.isFeatured = !review.isFeatured;
  await review.save();
  
  return review;
};



/* ========================
   ADMIN MODERATION LIST
======================== */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAdminReviews = async ({ page = 1, limit = 10, rating, featured, search } = {}) => {
  const filter = {};
  if (rating) filter.rating = rating;
  if (featured !== undefined) filter.isFeatured = featured === true || featured === "true";

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const [users, venues] = await Promise.all([
      User.find({ name: rx }).select("_id").lean(),
      Venue.find({ venueName: rx }).select("_id").lean(),
    ]);
    filter.$or = [
      { comment: rx },
      { title: rx },
      { user: { $in: users.map((u) => u._id) } },
      { venue: { $in: venues.map((v) => v._id) } },
    ];
  }

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort("-createdAt -_id")
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("user", "name avatar")
      .populate("venue", "venueName")
      .lean(),
    Review.countDocuments(filter),
  ]);

  return { reviews, total, pages: Math.ceil(total / limit) };
};

module.exports = {
  getAdminReviews,
  addReview,
  getVenueReviews,
  getReviewsForOwnerVenues,
  deleteReview,
  getFeaturedReviews,
  toggleFeaturedStatus
};