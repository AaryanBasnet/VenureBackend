const express = require("express");
const {
  getAllVenues,
  updateVenueStatus,
  getApprovedVenueCount
} = require("../../controller/admin/venueController");

const router = express.Router();

router.get("/", getAllVenues);
router.get("/getApprovedCount", getApprovedVenueCount);

router.patch("/:id/status", updateVenueStatus);
module.exports = router;
