const express = require("express");
const router = express.Router();
const reviewController = require("../controller/reviewController");
const { authenticateUser, isOwner, isAdmin } = require("../middleware/authorizedUser");

router.get(
  "/owner/reviews",
  authenticateUser,
  isOwner,
  reviewController.getReviewsForOwnerVenues
);

router.post("/:id/reviews", authenticateUser, reviewController.addReview);
router.get("/:id/reviews",  reviewController.getReviews);
router.delete(
  "/:venueId/reviews/:reviewId",
  authenticateUser,
  isOwner,
  reviewController.deleteReview
);

module.exports = router;
