const express = require("express");
const router = express.Router();
const reviewController = require("../controller/reviewController");
const { authenticateUser } = require("../middleware/authorizedUser");

router.get("/owner/reviews", authenticateUser, reviewController.getReviewsForOwnerVenues);

router.post("/:id/reviews", authenticateUser, reviewController.addReview)
router.get("/:id/reviews", reviewController.getReviews);
router.delete(
      "/:venueId/reviews/:reviewId",
      authenticateUser,
      reviewController.deleteReview

)
router.get("/owner/reviews", authenticateUser, reviewController.getReviewsForOwnerVenues);
module.exports = router;
