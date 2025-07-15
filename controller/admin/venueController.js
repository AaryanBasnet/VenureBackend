const Venue = require("../../model/venue");
const Notification = require("../../model/notification");
const User = require("../../model/user");

exports.getAllVenues = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const filters = {};

    // Filter by status if provided and not 'all'
    if (status && status !== "all") {
      filters.status = status;
    }

    // Search by venueName or city (case-insensitive)
    if (search) {
      const searchRegex = new RegExp(search, "i"); // case-insensitive
      filters.$or = [
        { venueName: searchRegex },
        { "location.city": searchRegex },
      ];
    }

    const skip = (page - 1) * limit;

    // Query with filters, pagination, and populate owner
    const venues = await Venue.find(filters)
      .populate("owner", "name email")
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Total count for pagination
    const totalVenues = await Venue.countDocuments(filters);

    res.status(200).json({
      success: true,
      data: venues,
      pagination: {
        total: totalVenues,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getApprovedVenueCount = async (req, res) => {
  try {
    const totalApproved = await Venue.countDocuments({ status: "approved" });
    res.status(200).json({
      success: true,
      totalApproved,
    });
  } catch (err) {
    console.error("Error fetching approved venue count:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateVenueStatus = async (req, res) => {
  const { id } = req.params;

  const status = req.body.status;

  if (!["approved", "rejected", "pending"].includes(status)) {
    console.log("Invalid status received!");
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    const updatedVenue = await Venue.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updatedVenue) {
      return res
        .status(404)
        .json({ success: false, message: "Venue not found" });
    }

    const owner = updatedVenue.owner;
    if (owner && owner._id) {
      const notification = await Notification.create({
        recipient: owner._id,
        type: "approval",
        message: `Your venue "${updatedVenue.venueName}" has been ${status}.`,
        link: `/venues/${updatedVenue._id}`,
      });

      // Emit socket notification if io is available on req.app
      const io = req.app.get("io");
      if (io) {
        io.to(owner._id.toString()).emit("newNotification", notification);
      }
    }

    res.status(200).json({ success: true, data: updatedVenue });
  } catch (err) {
    console.error("Error updating venue:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
