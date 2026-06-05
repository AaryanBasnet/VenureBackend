const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const AppError = require("../utils/AppError");

/* =========================================================================
   CLOUDINARY CONFIGURATION
========================================================================= */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* =========================================================================
   DYNAMIC STORAGE ENGINE
========================================================================= */
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folderPath = "venure/others";

    // Dynamically route images to specific Cloudinary folders
    if (file.fieldname === "profileImage") {
      folderPath = "venure/users";
    } else if (file.fieldname === "venueImages") {
      const venueId = req.params.venueId || req.params.id || req.body.venueId || "unassigned";
      folderPath = `venure/venues/${venueId}`;
    }

    return {
      folder: folderPath,
      // Enterprise Optimization: Auto-convert heavy PNGs to lightweight WebP
      format: "webp", 
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      // Optional: Auto-compress and scale down massive 4K images to save bandwidth
      transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
    };
  },
});

/* =========================================================================
   SECURITY FILTER & UPLOAD INSTANCE
========================================================================= */
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new AppError("Only image files are allowed.", 400), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB hard limit
  fileFilter,
});

module.exports = {
  profileImage: () => upload.single("profileImage"),
  venueImages: (maxCount = 10) => upload.array("venueImages", maxCount),
  fields: (fieldsArray) => upload.fields(fieldsArray),
  cloudinary, // Exported so your services can use it to delete images later
};