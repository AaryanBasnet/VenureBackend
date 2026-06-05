const express = require("express");
const router = express.Router();

const reviewController = require("../controller/reviewController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { createReviewSchema } = require("../validators/reviewValidators");

/* =========================================================================
   PUBLIC ROUTES
========================================================================= */
// Get all reviews for a specific venue
router.get("/venue/:venueId", reviewController.getReviews);

router.get("/featured", reviewController.getFeaturedReviews);

/* =========================================================================
   PROTECTED ROUTES
========================================================================= */
router.use(protectRoute);

// Customer Action: Leave a review
router.post(
  "/venue/:venueId",
  authorizeRoles("Customer", "Admin"),
  validate(createReviewSchema, "body"),
  reviewController.addReview
);

// Customer/Admin Action: Delete a review
router.delete(
  "/:reviewId",
  authorizeRoles("Customer", "Admin"),
  reviewController.deleteReview
);

// Venue Owner Dashboard: See all reviews left on their venues
router.get(
  "/owner",
  authorizeRoles("VenueOwner"),
  reviewController.getReviewsForOwnerVenues
);

router.patch(
  "/:reviewId/feature",
  authorizeRoles("Admin"),
  reviewController.toggleFeaturedStatus
);

module.exports = router;