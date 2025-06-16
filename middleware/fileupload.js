const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

// Create directory if not exists
function ensureDirExist(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = "uploads/others"; // Default path

        // Determine context: profile or venue
        if (file.fieldname === "profileImage") {
            uploadPath = `uploads/users`;
        } else if (file.fieldname === "venueImages" && req.body.venueName) {
            const safeVenueName = req.body.venueName.trim().replace(/\s+/g, "_");
            uploadPath = `uploads/venues/${safeVenueName}`;
        }

        ensureDirExist(uploadPath);
        cb(null, uploadPath);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname); // .jpg, .png, etc.
        const uniqueName = `${file.fieldname}-${uuidv4()}${ext}`;
        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("Only image files are allowed."), false);
    }
};

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter
});

module.exports = {
    // For uploading a single profile image
    profileImage: () => upload.single("profileImage"),

    // For uploading multiple venue images
    venueImages: (maxCount = 10) => upload.array("venueImages", maxCount),

    // Flexible for multiple field uploads
    fields: (fieldsArray) => upload.fields(fieldsArray),
};
