const express = require("express");
const router = express.Router();
const favoriteController = require("../controller/favoritesController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { toggleFavoriteSchema } = require("../validators/favoriteValidators");

// All favorite routes require the user to be logged in (Customer or Admin)
router.use(protectRoute);

// Get all favorite venues for the logged-in user
router.get("/", favoriteController.getFavorites);

// Toggle a venue in/out of favorites
router.post(
  "/:venueId", 
  validate(toggleFavoriteSchema, "params"), 
  favoriteController.toggleFavorite
);

module.exports = router;