// routes/venueRoutes.js

const express = require("express");
const router = express.Router();
const venueController = require("../../controller/venueOwner/venueManagement");
const upload = require("../../middleware/fileupload"); // your multer config
const {
  authenticateUser,
  isOwner,
} = require("../../middleware/authorizedUser");

router.get(
  "/approvedCountByOwner",
  authenticateUser,

  venueController.getApprovedVenueCountByOwner
);

router.get("/", authenticateUser, isOwner, venueController.getVenuesByOwner);

// 1. Create venue (without images)
router.post(
  "/",
  authenticateUser,
  isOwner,

  venueController.createVenue
);

// 2. Upload images for a venue (max 10 files)
router.post(
  "/:venueId/images",
  upload.venueImages(10), // multer middleware for multiple images
  authenticateUser,
  isOwner,
  venueController.uploadVenueImages
);

// 3. Update venue info (and optionally replace images)
router.put(
  "/:id",
  upload.venueImages(10), // allow new images upload for replacement
  authenticateUser,
  isOwner,

  venueController.updateVenue
);

// 4. Delete venue
router.delete("/:id", authenticateUser, isOwner, venueController.deleteVenue);

// 5. Get venues by owner

module.exports = router;
