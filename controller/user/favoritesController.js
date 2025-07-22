const User = require("../../model/user");
const Venue = require("../../model/venue");

exports.toggleFavorite = async (req, res) => {
  const userId = req.user.id;
  const { venueId } = req.params;

  try {
    const user = await User.findById(userId);
const isFavorited = user.favorites.some(favId =>
  favId.equals(venueId)
);
    if (isFavorited) {
      user.favorites.pull(venueId); // remove
    } else {
      user.favorites.push(venueId); // add
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: isFavorited ? "Removed from favorites" : "Added to favorites",
      favorites: user.favorites,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getFavorites = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId).populate("favorites");
    res.status(200).json({
      success: true,
      favorites: user.favorites,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
//returns the favorites array
exports.getFavoriteVenues = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).populate("favorites");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(user.favorites);
  } catch (err) {
    console.error("Error fetching favorite venues:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
