const Venue = require("../../model/venue");

exports.getAllVenues = async (req, res) => {
  try {
    const venues = await Venue.find().populate("owner", "name email");
    res.status(200).json({ success: true, data: venues });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateVenueStatus = async (req, res) => {
 console.log("PATCH request received for ID:", req.params.id);
  console.log("req.body:", req.body); // Log entire body
 const { id } = req.params;

  const status = req.body.status;
  console.log("Extracted status:", status); // Log extracted status

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
      return res.status(404).json({ success: false, message: "Venue not found" });
    }

    res.status(200).json({ success: true, data: updatedVenue });
  } catch (err) {
    console.error("Error updating venue:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

