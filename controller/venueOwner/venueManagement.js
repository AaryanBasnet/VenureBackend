const Venue = require("../../model/venue");

exports.createVenue = async (req, res) => {
  try {
    const {
      venueName,
      capacity,
      description,
      ownerId,
      pricePerHour,
      amenities,
      address,
      city,
      state,
      country,
    } = req.body;

    // Handle image files uploaded via multer
    const venueImages = (req.files || []).map((file) => ({
      filename: file.filename,
      url: file.path.replace(/\\/g, "/"), // normalize for Windows paths
    }));

    const venue = new Venue({
      venueName,
      capacity,
      description,
      owner: ownerId,
      pricePerHour,
      amenities: amenities
        ? Array.isArray(amenities)
          ? amenities
          : [amenities]
        : [],
      location: {
        address,
        city,
        state,
        country,
      },
      venueImages,
    });

    await venue.save();

    return res.status(201).json({
      success: true,
      message: "Venue Created Successfully",
      data: venue,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Failed to create venue",
      error: err.message,
    });
  }
};
