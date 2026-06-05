const User = require("../model/User");
const Venue = require("../model/Venue");
const AppError = require("../utils/AppError");

const toggleFavorite = async (userId, venueId) => {
  // 1. Ensure the venue actually exists and isn't soft-deleted
  const venue = await Venue.findOne({ _id: venueId, isDeleted: false });
  if (!venue) throw new AppError("Venue not found", 404);

  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  // 2. Check if the venue is already favorited
  const isFavorited = user.favorites.some((favId) => favId.equals(venueId));

  // 3. Toggle logic
  if (isFavorited) {
    user.favorites.pull(venueId);
  } else {
    user.favorites.push(venueId);
  }

  await user.save();

  return {
    isFavorited: !isFavorited, // Returns the NEW state
    favorites: user.favorites,
  };
};

const getFavoriteVenues = async (userId) => {
  const user = await User.findById(userId).populate({
    path: "favorites",
    match: { isDeleted: false, status: "approved" }, // Only populate active, approved venues
    select: "venueName location averageRating venueImages pricePerHour", 
  });

  if (!user) throw new AppError("User not found", 404);

  // Filter out any nulls in case a venue was hard-deleted from the database
  return user.favorites.filter((venue) => venue !== null);
};

module.exports = {
  toggleFavorite,
  getFavoriteVenues,
};