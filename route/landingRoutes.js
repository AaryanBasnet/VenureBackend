const express = require("express");
const router = express.Router();

const landingController = require("../controller/landingController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { landingContentSchema } = require("../validators/landingValidators");

// Public: the home page's editorial copy plus live venue counts per category
router.get("/", landingController.getLanding);

// Admin only: replace the whole content document
router.put("/", protectRoute, authorizeRoles("Admin"), validate(landingContentSchema, "body"), landingController.updateLanding);

module.exports = router;
