// controllers/venueController.js

const Venue = require("../../model/venue");
const fs = require("fs");
const path = require("path");

// Helper: Delete images from disk
function deleteImages(images = []) {
  images.forEach((img) => {
    const imgPath = path.join(__dirname, "../../../", img.url);
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
    }
  });
}

// -------------------- CREATE VENUE --------------------
exports.createVenue = async (req, res) => {
  console.log("Received body in createVenue:", req.body);

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
      location,
    } = req.body;

    // Parse amenities safely
    let parsedAmenities = [];
    if (amenities) {
      if (typeof amenities === "string") {
        try {
          parsedAmenities = JSON.parse(amenities);
          if (!Array.isArray(parsedAmenities)) parsedAmenities = [];
        } catch {
          parsedAmenities = [];
        }
      } else if (Array.isArray(amenities)) {
        parsedAmenities = amenities;
      }
    }

    // Parse location safely
    let parsedLocation = {};
    if (typeof location === "string") {
      try {
        parsedLocation = JSON.parse(location);
      } catch (err) {
        console.error("Invalid location JSON string:", err);
        parsedLocation = {};
      }
    } else if (typeof location === "object" && location !== null) {
      parsedLocation = location;
    }

    // Fallback to flat fields if location is incomplete
    if (
      !parsedLocation.address ||
      !parsedLocation.city ||
      !parsedLocation.state ||
      !parsedLocation.country
    ) {
      parsedLocation = {
        address: (req.body.address || "").trim(),
        city: (req.body.city || "").trim(),
        state: (req.body.state || "").trim(),
        country: (req.body.country || "").trim(),
      };
    }

    console.log("Final parsedLocation:", parsedLocation);

    // Final venue creation
    const venue = new Venue({
      venueName,
      capacity,
      description,
      owner: ownerId,
      pricePerHour,
      amenities: parsedAmenities,
      location: parsedLocation,
      venueImages: [],
    });

    await venue.save();
    const savedVenue = await Venue.findById(venue._id);

    return res.status(201).json({
      success: true,
      message: "Venue created. Upload images separately.",
      data: savedVenue,
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


// -------------------- UPLOAD VENUE IMAGES --------------------
exports.uploadVenueImages = async (req, res) => {
  try {
    const { venueId } = req.params;
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res
        .status(404)
        .json({ success: false, message: "Venue not found" });
    }

    const images = (req.files || []).map((file) => ({
      filename: file.filename,
      url: file.path.replace(/\\/g, "/"),
    }));

    venue.venueImages = venue.venueImages.concat(images);
    await venue.save();

    return res.status(200).json({
      success: true,
      message: "Images uploaded successfully",
      data: venue,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Failed to upload images",
      error: err.message,
    });
  }
};

// -------------------- UPDATE VENUE --------------------
exports.updateVenue = async (req, res) => {
  try {
    const venueId = req.params.id;
    const existingVenue = await Venue.findById(venueId);
    if (!existingVenue) {
      return res
        .status(404)
        .json({ success: false, message: "Venue not found" });
    }

    const {
      venueName,
      capacity,
      description,
      pricePerHour,
      amenities,
      address,
      city,
      state,
      country,
      location,
    } = req.body;

    // Handle amenities
    let parsedAmenities = [];
    if (amenities) {
      if (typeof amenities === "string") {
        try {
          parsedAmenities = JSON.parse(amenities);
          if (!Array.isArray(parsedAmenities)) parsedAmenities = [];
        } catch {
          parsedAmenities = [];
        }
      } else if (Array.isArray(amenities)) {
        parsedAmenities = amenities;
      }
    }

    // Handle location
    let parsedLocation = {};
    if (location && typeof location === "string") {
      try {
        parsedLocation = JSON.parse(location);
      } catch {
        parsedLocation = {};
      }
    } else {
      parsedLocation = {
        address: address || "",
        city: city || "",
        state: state || "",
        country: country || "",
      };
    }

    const updateData = {
      venueName,
      capacity,
      description,
      pricePerHour,
      amenities: parsedAmenities,
      location: parsedLocation,
    };

    // Replace images if new ones uploaded
    if (req.files && req.files.length > 0) {
      deleteImages(existingVenue.venueImages);

      const newImages = req.files.map((file) => ({
        filename: file.filename,
        url: file.path.replace(/\\/g, "/"),
      }));
      updateData.venueImages = newImages;
    }

    const updatedVenue = await Venue.findByIdAndUpdate(venueId, updateData, {
      new: true,
    });

    return res.status(200).json({
      success: true,
      message: "Venue updated successfully",
      data: updatedVenue,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Failed to update venue",
      error: err.message,
    });
  }
};

// -------------------- DELETE VENUE --------------------
exports.deleteVenue = async (req, res) => {
  try {
    const venueId = req.params.id;
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res
        .status(404)
        .json({ success: false, message: "Venue not found" });
    }

    deleteImages(venue.venueImages);

    const folderPath = path.join(__dirname, "../../../uploads/venues", venueId);
    if (fs.existsSync(folderPath)) {
      fs.rmdirSync(folderPath, { recursive: true });
    }

    await venue.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Venue deleted successfully",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete venue",
      error: err.message,
    });
  }
};

// -------------------- GET VENUES BY OWNER --------------------
exports.getVenuesByOwner = async (req, res) => {
  try {
    const ownerId = req.query.ownerId;
    if (!ownerId) {
      return res
        .status(400)
        .json({ success: false, message: "Owner ID is required" });
    }

    const venues = await Venue.find({ owner: ownerId });

    return res.status(200).json({
      success: true,
      data: venues,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
