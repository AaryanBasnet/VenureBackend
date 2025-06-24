const Venue = require("../../model/venue");


exports.getAllApprovedVenues = async (req, res) => {
   try {
    const venues = await Venue.find({
      status: "approved",
      isDeleted: false,
    });

    res.status(200).json({
      message: "Approved venues fetched successfully",
      data: venues,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch venues", error });
  }
};