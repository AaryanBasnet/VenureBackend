const mongoose = require("mongoose");
const logger = require("../utils/logger");

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    venue: { // 
      type: mongoose.Schema.Types.ObjectId,
      ref: "Venue",
      required: true,
      index: true, // Fast lookups for venue reviews
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      maxlength: 100,
      default: "",
    },
    comment: {
      type: String,
      maxlength: 1000,
      required: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true, // Speeds up the query for the landing page
    },
    helpfulCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

/* =========================================================================
   ENTERPRISE LAYER: Auto-calculate Average Rating
   Whenever a review is saved or deleted, recalculate the venue's stats
========================================================================= */
reviewSchema.statics.calculateAverageRating = async function (venueId) {
  const stats = await this.aggregate([
    { $match: { venue: venueId } },
    {
      $group: {
        _id: "$venue",
        avgRating: { $avg: "$rating" },
        numOfReviews: { $sum: 1 },
      },
    },
  ]);

  try {
    await mongoose.model("Venue").findByIdAndUpdate(venueId, {
      averageRating: stats.length > 0 ? Math.round(stats[0].avgRating * 10) / 10 : 0,
      totalReviews: stats.length > 0 ? stats[0].numOfReviews : 0,
    });
  } catch (err) {
    logger.error({ message: "Error updating venue average rating", venueId, error: err.message });
  }
};

// Call the calculator after a review is saved
reviewSchema.post("save", function () {
  this.constructor.calculateAverageRating(this.venue);
});

// Prevent duplicate reviews from the same user on the same venue
reviewSchema.index({ venue: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);