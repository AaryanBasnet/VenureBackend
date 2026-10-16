const mongoose = require("mongoose");
const User = require("../model/user");
const Venue = require("../model/venue");
const AppError = require("../utils/AppError");
const { attachCapacity } = require("./venueService");

const toggleFavorite = async (userId, venueId) => {
  // 1. Ensure the venue actually exists and isn't soft-deleted
  const venue = await Venue.exists({ _id: venueId, isDeleted: false });
  if (!venue) throw new AppError("Venue not found", 404);

  // 2. Toggle in ONE atomic update. The old read-modify-write (load the user, push/pull, save) lost updates and
  // could push the same venue twice when two requests raced; a pipeline update is evaluated against the stored
  // array under the document lock, so N concurrent toggles always land on the right parity and never duplicate.
  const id = new mongoose.Types.ObjectId(String(venueId));
  const favorites = { $ifNull: ["$favorites", []] };
  const user = await User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          favorites: {
            $cond: [
              { $in: [id, favorites] },
              { $filter: { input: favorites, cond: { $ne: ["$$this", id] } } },
              { $concatArrays: [favorites, [id]] },
            ],
          },
        },
      },
    ],
    { new: true, projection: { favorites: 1 } }
  ).lean();
  if (!user) throw new AppError("User not found", 404);

  return {
    isFavorited: user.favorites.some((favId) => String(favId) === String(id)), // the NEW state
    favorites: user.favorites,
  };
};

const getFavoriteVenues = async (userId) => {
  const user = await User.findById(userId).select("favorites").lean();
  if (!user) throw new AppError("User not found", 404);

  // Only active, approved venues, carrying the card fields (largest space and number of spaces are stored on the venue)
  const venues = await Venue.find({ _id: { $in: user.favorites || [] }, isDeleted: false, status: "approved" })
    .select("venueName location averageRating totalReviews venueImages category packages minPricePerPlate maxCapacity spaceCount")
    .lean();

  // Keep the order the user favourited them in; venues hard-deleted from the database simply do not appear
  const byId = new Map(venues.map((v) => [String(v._id), v]));
  const ordered = user.favorites.map((id) => byId.get(String(id))).filter(Boolean);
  return attachCapacity(ordered);
};

module.exports = {
  toggleFavorite,
  getFavoriteVenues,
};