const Venue = require("../model/venue"); // Fix require path and model

// Add review to venue
exports.addReview = async (req, res) => {
  try {
    const { id: venueId } = req.params;
    const { rating, comment, title } = req.body;
    const userId = req.user._id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Invalid rating" });
    }

    if (comment && comment.length > 500) {
      return res.status(400).json({ success: false, message: "Comment too long" });
    }

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
    }

    const existingReview = venue.reviews.find(
      (r) => r.user.toString() === userId.toString()
    );
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this venue",
      });
    }

    venue.reviews.push({ user: userId, rating, comment, title });

    // Calculate average rating rounded to 1 decimal place
    venue.averageRating =
      Math.round(
        (venue.reviews.reduce((sum, r) => sum + r.rating, 0) / venue.reviews.length) *
          10
      ) / 10;

    await venue.save();

    res.status(201).json({ success: true, data: venue.reviews });
  } catch (err) {
    console.error("Add review error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get all reviews of a venue
exports.getReviews = async (req, res) => {
  try {
    const { id: venueId } = req.params;
    const venue = await Venue.findById(venueId).populate({
      path: "reviews.user",
      select: "name avatar email", // adjust to your User fields
    });

    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
    }

    res.status(200).json({ success: true, data: venue.reviews });
  } catch (err) {
    console.error("Get reviews error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete a review (user can delete their own review)
exports.deleteReview = async (req, res) => {
  try {
    const { venueId, reviewId } = req.params;
    const userId = req.user._id;

    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
    }

    const reviewIndex = venue.reviews.findIndex(
      (r) => r._id.toString() === reviewId && r.user.toString() === userId.toString()
    );

    if (reviewIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Review not found or unauthorized",
      });
    }

    venue.reviews.splice(reviewIndex, 1);

    if (venue.reviews.length > 0) {
      venue.averageRating =
        Math.round(
          (venue.reviews.reduce((sum, r) => sum + r.rating, 0) /
            venue.reviews.length) *
            10
        ) / 10;
    } else {
      venue.averageRating = 0;
    }

    await venue.save();

    res.status(200).json({ success: true, message: "Review deleted" });
  } catch (err) {
    console.error("Delete review error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getReviewsForOwnerVenues = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const venues = await Venue.find({ owner: ownerId }).populate({
      path: "reviews.user",
      select: "name email avatar",
    });

    const result = venues.map((venue) => ({
      venueId: venue._id,
      venueName: venue.venueName,
      reviews: venue.reviews,
      averageRating: venue.averageRating,
    }));

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("Error fetching reviews for owner's venues:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
