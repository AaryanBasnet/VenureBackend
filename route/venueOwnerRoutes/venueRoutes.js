const express = require("express");

const { venueImages } = require("../../middleware/fileupload");
const { createVenue } = require("../../controller/venueOwner/venueManagement");

const router = express.Router();

router.post("/create", venueImages(5), createVenue);

module.exports = router;
