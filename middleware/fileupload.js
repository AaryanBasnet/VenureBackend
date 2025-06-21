// upload.js
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

function ensureDirExist(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "uploads/others";

    if (file.fieldname === "profileImage") {
      uploadPath = "uploads/users";
    } else if (file.fieldname === "venueImages") {
      // ✅ Use venue ID from URL param or pre-generated temp ID
      const venueId = req.params.venueId || req.params.id || req.body.venueId;
      uploadPath = `uploads/venues/${venueId}`;
    }

    ensureDirExist(uploadPath);
    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${file.fieldname}-${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});

module.exports = {
  profileImage: () => upload.single("profileImage"),
  venueImages: (maxCount = 10) => upload.array("venueImages", maxCount),
  fields: (fieldsArray) => upload.fields(fieldsArray),
};
