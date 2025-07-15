// controllers/venueController.js

const Venue = require("../../model/venue");
const fs = require("fs");
const path = require("path");
const ActivityLog = require("../../model/activityLog");
const User = require("../../model/user");
const Notification = require("../../model/notification");

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
    await ActivityLog.create({
      message: `New venue created: ${venueName}`,
      icon: "BuildingLibraryIcon",
      color: "text-blue-600",
      type: "venue",
    });

    const admins = await User.find({ role: "Admin" }).select("_id");

    let createdNotifications = [];
    try {
      createdNotifications = await Promise.all(
        admins.map(async (admin) =>
          Notification.create({
            recipient: admin._id,
            type: "venue",
            message: `New venue \"${venueName}\" added by  ${
              req.user?.name || "Owner"
            }`,
            link: `/admin/venues/${venue._id}`,
          })
        )
      );
      console.log("Notifications created:", createdNotifications);
    } catch (err) {
      console.error("Error creating notification:", err);
    }

    const io = req.app.get("io");
    admins.forEach((admin) => {
      io.to(admin._id.toString()).emit(
        "newNotification",
        createdNotifications.find(
          (n) => n.recipient.toString() === admin._id.toString()
        )
      );
    });

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

// -------------------- UPDATE VENUE --------------------
exports.updateVenue = async (req, res) => {
  try {
    const venueId = req.params.id;
    const existingVenue = await Venue.findById(venueId);
    if (!existingVenue) {
      return res.status(404).json({ success: false, message: "Venue not found" });
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
      return res.status(404).json({ success: false, message: "Venue not found" });
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

// -------------------- GET APPROVED VENUE COUNT BY OWNER --------------------
exports.getApprovedVenueCountByOwner = async (req, res) => {
  try {
    const ownerId = req.query.ownerId;

    if (!ownerId) {
      return res.status(400).json({
        success: false,
        message: "Owner ID is required",
      });
    }

    const count = await Venue.countDocuments({
      owner: ownerId,
      status: "approved",
    });

    return res.status(200).json({
      success: true,
      count,
    });
  } catch (err) {
    console.error("Error fetching approved count by owner:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};
