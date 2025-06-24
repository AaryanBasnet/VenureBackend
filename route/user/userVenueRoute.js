const express = require("express");
const router = express.Router();
const {getAllApprovedVenues} = require("../../controller/user/userVenueController");

router.get("/getApprovedVenues", getAllApprovedVenues);

module.exports = router;



