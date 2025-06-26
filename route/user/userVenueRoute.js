const express = require("express");
const router = express.Router();
const {getAllApprovedVenues, getVenueById} = require("../../controller/user/userVenueController");

router.get("/getApprovedVenues", getAllApprovedVenues);

router.get("/:id", getVenueById);

module.exports = router;



