const User = require("../../model/user");
const path = require("path");




exports.updateUserProfile = async (req, res) => {
  const userId = req.user._id; // from authenticateUser middleware
  const { name, phone, address } = req.body;
  let updateFields = {};

  if (name) updateFields.name = name;
  if (phone) updateFields.phone = phone;
  if (address) updateFields.address = address;

  // Handle uploaded profile image
  if (req.file) {
    const imagePath = path.join("/", req.file.destination, req.file.filename).replace(/\\/g, "/");
    updateFields.avatar = imagePath;
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true }
    ).select("-password"); // exclude password

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
