const Review = require("../model/review"); 
const Venue = require("../model/venue");   
const Booking = require("../model/booking");
const AppError = require("../utils/AppError");

/* ========================
   CREATE / VERIFY
======================== */
const addReview = async (venueId, userId, payload) => {
  const venue = await Venue.findById(venueId);
  if (!venue) throw new AppError("Venue not found", 404);

  // 1. Prevent duplicate reviews
  const existingReview = await Review.findOne({ venue: venueId, user: userId });
  if (existingReview) {
    throw new AppError("You have already reviewed this venue", 400);
  }

  // 2. ENTERPRISE CHECK: Did this user actually complete a booking here?
  const validBooking = await Booking.findOne({
    venue: venueId,
    customer: userId,
    status: "completed", // Or "approved" depending on your exact business flow
  });

  if (!validBooking) {
    throw new AppError("You can only review venues after a completed booking.", 403);
  }

  // 3. Create the review (Mongoose post-save hook will auto-update the venue's average)
  const review = await Review.create({
    venue: venueId,
    user: userId,
    ...payload,
  });

  return review;
};

/* ========================
   FETCH REVIEWS
======================== */
const getVenueReviews = async (venueId) => {
  // Fetch from the new decoupled Review collection, not the Venue document
  return await Review.find({ venue: venueId })
    .populate("user", "name email avatar")
    .sort("-createdAt"); // Newest first
};

const getReviewsForOwnerVenues = async (ownerId) => {
  // 1. Get all venues owned by this user
  const ownerVenues = await Venue.find({ owner: ownerId }).select("_id venueName");
  const venueIds = ownerVenues.map((v) => v._id);

  // 2. Find all reviews linked to those specific venues
  const reviews = await Review.find({ venue: { $in: venueIds } })
    .populate("user", "name email avatar")
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



module.exports = {
  addReview,
  getVenueReviews,
  getReviewsForOwnerVenues,
  deleteReview,
  getFeaturedReviews,
  toggleFeaturedStatus
};