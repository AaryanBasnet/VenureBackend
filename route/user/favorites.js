const express = require("express");
const router = express.Router();
const {
  toggleFavorite,
  getFavorites,
  getFavoriteVenues
} = require("../../controller/user/favoritesController");
const { authenticateUser } = require("../../middleware/authorizedUser");

router.post("/:venueId", authenticateUser, toggleFavorite);
router.get("/", authenticateUser, getFavorites);
router.get("/venues", authenticateUser, getFavoriteVenues); 

module.exports = router;
