const express = require("express");
const {
  getAllVenues,
  updateVenueStatus,
} = require("../../controller/admin/venueController");

const router = express.Router();

router.get("/", getAllVenues);
router.patch("/:id/status", updateVenueStatus);
module.exports = router;
