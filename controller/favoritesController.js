const asyncHandler = require("../utils/asyncHandler");
const favoriteService = require("../services/favoriteService");

exports.toggleFavorite = asyncHandler(async (req, res) => {
  const result = await favoriteService.toggleFavorite(req.user._id, req.params.venueId);

  res.status(200).json({
    success: true,
    message: result.isFavorited ? "Added to favorites" : "Removed from favorites",
    data: result.favorites,
  });
});

exports.getFavorites = asyncHandler(async (req, res) => {
  const favorites = await favoriteService.getFavoriteVenues(req.user._id);

  res.status(200).json({
    success: true,
    data: favorites,
  });
});