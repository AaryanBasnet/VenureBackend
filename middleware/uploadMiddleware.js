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
// The Cloudinary SDK reports a rejected upload twice: to the callback AND through an internal promise nobody can
// reach. That second one surfaces as an unhandled rejection, which server.js treats as fatal, so one corrupt file
// would take the whole API down. `disable_promises` turns the second report off; the callback still gets the error.
const withoutPromises = (paramsFor) => async (req, file) => ({ ...(await paramsFor(req, file)), disable_promises: true });

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: withoutPromises(async (req, file) => {
    let folderPath = "venure/others";

    // Dynamically route images to specific Cloudinary folders
    if (file.fieldname === "profileImage") {
      folderPath = "venure/users";
    } else if (file.fieldname === "venueImages") {
      const venueId = req.params.venueId || req.params.id || req.body.venueId || "unassigned";
      folderPath = `venure/venues/${venueId}`;
    }

    if (file.fieldname === "applicationPhotos") {
      // Shown on the venue page once the application is approved, so these are ordinary public images.
      return { folder: "venure/applications", format: "webp", allowed_formats: ["jpg", "jpeg", "png", "webp"], transformation: [{ width: 1600, crop: "limit", quality: "auto" }] };
    }
    if (file.fieldname === "registrationCert" || file.fieldname === "panCert") {
      // Business papers: private, reachable only through a signed link for an admin.
      return { folder: "venure/applications-private", resource_type: "auto", type: "authenticated", allowed_formats: ["pdf", "jpg", "jpeg", "png"] };
    }
    if (file.fieldname === "attachments") {
      // Private: only reachable through a signed link the API hands to the customer and the venue owner.
      return {
        folder: "venure/inquiries",
        resource_type: "auto",
        type: "authenticated",
        allowed_formats: ["pdf", "jpg", "jpeg", "png", "webp"],
      };
    }

    return {
      folder: folderPath,
      // Enterprise Optimization: Auto-convert heavy PNGs to lightweight WebP
      format: "webp", 
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
      // Optional: Auto-compress and scale down massive 4K images to save bandwidth
      transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
    };
  }),
});

/* =========================================================================
   SECURITY FILTER & UPLOAD INSTANCE
========================================================================= */
const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 3;

const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const APPLICATION_MAX_PHOTOS = 12;

const fileFilter = (req, file, cb) => {
  if (file.fieldname === "applicationPhotos") {
    return PHOTO_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new AppError("Photos must be JPG, PNG or WebP.", 400), false);
  }
  if (file.fieldname === "registrationCert" || file.fieldname === "panCert") {
    return DOCUMENT_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new AppError("Documents must be a PDF, JPG or PNG.", 400), false);
  }
  if (file.fieldname === "attachments") {
    return ATTACHMENT_TYPES.includes(file.mimetype)
      ? cb(null, true)
      : cb(new AppError("Attach a PDF, JPG, PNG or WebP file.", 400), false);
  }
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

const attachmentUpload = multer({
  storage,
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: ATTACHMENT_MAX_COUNT },
  fileFilter,
});

const applicationUpload = multer({
  storage,
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: APPLICATION_MAX_PHOTOS + 2 },
  fileFilter,
});

module.exports = {
  venueApplicationFiles: () =>
    applicationUpload.fields([
      { name: "applicationPhotos", maxCount: APPLICATION_MAX_PHOTOS },
      { name: "registrationCert", maxCount: 1 },
      { name: "panCert", maxCount: 1 },
    ]),
  inquiryAttachments: () => attachmentUpload.array("attachments", ATTACHMENT_MAX_COUNT),
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  profileImage: () => upload.single("profileImage"),
  venueImages: (maxCount = 10) => upload.array("venueImages", maxCount),
  fields: (fieldsArray) => upload.fields(fieldsArray),
  cloudinary, // Exported so your services can use it to delete images later
};