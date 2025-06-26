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


exports.getVenueById = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) {
      return res.status(404).json({
        message: "Venue not found",
        statusCode: 404,
        data: null,
      });
    }
    res.status(200).json({
      message: "Venue fetched successfully",
      statusCode: 200,
      data: venue,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch venue",
      statusCode: 500,
      data: null,
    });
  }
};