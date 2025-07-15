const Venue = require("../../model/venue");

exports.getAllApprovedVenues = async (req, res) => {
  try {
    const {
      search,
      city,
      capacityRange,
      amenities,
      sort,
      page = 1,
      limit = 6,
    } = req.query;

    const filter = {
      status: "approved",
      isDeleted: false,
    };

    // Search by name (case-insensitive)
    if (search) {
      filter.venueName = { $regex: search, $options: "i" };
    }

    // Filter by city
    if (city) {
      filter["location.city"] = city;
    }

    // Filter by capacity range
    if (capacityRange) {
      if (capacityRange === "1-50") filter.capacity = { $lte: 50 };
      else if (capacityRange === "51-100")
        filter.capacity = { $gt: 50, $lte: 100 };
      else if (capacityRange === "101-200")
        filter.capacity = { $gt: 100, $lte: 200 };
      else if (capacityRange === "201-") filter.capacity = { $gt: 200 };
    }

    // Filter by amenities (comma-separated string to array)
    if (amenities) {
      const amenitiesArray = amenities.split(",");
      filter.amenities = { $all: amenitiesArray };
    }

    // Sort option
    let sortOption = {};
    if (sort === "low-to-high") sortOption.pricePerHour = 1;
    else if (sort === "high-to-low") sortOption.pricePerHour = -1;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const total = await Venue.countDocuments(filter);
    const venues = await Venue.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum);

    res.status(200).json({
      message: "Approved venues fetched successfully",
      data: venues,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
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
