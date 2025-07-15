const express = require("express");
const router = express.Router();
const { updateUserProfile, getUserProfile } = require("../../controller/user/userController");
const { authenticateUser } = require("../../middleware/authorizedUser");
const { profileImage } = require("../../middleware/fileupload");
// GET profile (used on ProfilePage)
router.get("/profile", authenticateUser, getUserProfile);

// PUT profile update with image
router.put(
  "/profile",
  authenticateUser,
  profileImage(), // handles multipart/form-data with `profileImage`
  updateUserProfile
);

module.exports = router;
