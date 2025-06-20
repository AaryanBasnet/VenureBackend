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

// Create Venue (no images)
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
      location: { address, city, state, country },
      venueImages: [],
    });

    await venue.save();

    return res.status(201).json({
      success: true,
      message: "Venue created. Upload images separately.",
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

// Upload Images for Venue
exports.uploadVenueImages = async (req, res) => {
  try {
    const { venueId } = req.params;
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
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

// Update Venue (including optional image replacement)
exports.updateVenue = async (req, res) => {
  try {
    const venueId = req.params.id;
    const existingVenue = await Venue.findById(venueId);
    if (!existingVenue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
    }

    // Update basic fields
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
    } = req.body;

    const updateData = {
      venueName,
      capacity,
      description,
      pricePerHour,
      amenities: amenities
        ? Array.isArray(amenities)
          ? amenities
          : [amenities]
        : [],
      location: { address, city, state, country },
    };

    // If new images are uploaded, replace old ones
    if (req.files && req.files.length > 0) {
      // Delete old images from disk
      deleteImages(existingVenue.venueImages);

      // Map new images
      const newImages = req.files.map((file) => ({
        filename: file.filename,
        url: file.path.replace(/\\/g, "/"),
      }));
      updateData.venueImages = newImages;
    }

    // Save updates
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

// Delete Venue (and images)
exports.deleteVenue = async (req, res) => {
  try {
    const venueId = req.params.id;
    const venue = await Venue.findById(venueId);
    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
    }

    // Delete images from disk
    deleteImages(venue.venueImages);

    // Delete venue folder (optional)
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

// Get venues by owner
exports.getVenuesByOwner = async (req, res) => {
  try {
    const ownerId = req.query.ownerId;
    if (!ownerId) {
      return res.status(400).json({ success: false, message: "Owner ID is required" });
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
