const asyncHandler = require("../utils/asyncHandler");
const userService = require("../services/userService");

/* =========================================================================
   CUSTOMER / OWNER CONTROLLERS (Profile Management)
========================================================================= */
exports.getUserProfile = asyncHandler(async (req, res) => {
  const user = await userService.getUserProfile(req.user._id);

  res.status(200).json({ 
    success: true, 
    user: user // Kept as 'user' instead of 'data' to ensure your frontend doesn't break
  });
});

exports.updateUserProfile = asyncHandler(async (req, res) => {
  // req.body is validated by Zod, req.file is handled by the upload middleware
  const updatedUser = await userService.updateUserProfile(req.user._id, req.body, req.file);

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    user: updatedUser,
  });
});


/* =========================================================================
   ADMIN CONTROLLERS (User Management)
========================================================================= */
exports.getAllUsers = asyncHandler(async (req, res) => {
  // req.query is perfectly typed by Zod (page and limit are guaranteed numbers)
  const result = await userService.getPaginatedUsers(req.query);

  res.status(200).json({
    success: true,
    ...result,
  });
});

exports.getOneUser = asyncHandler(async (req, res) => {
  const user = await userService.getAdminUserById(req.params.id);

  res.status(200).json({
    success: true,
    data: user,
  });
});

exports.deleteUser = asyncHandler(async (req, res) => {
  await userService.softDeleteUser(req.params.id);

  res.status(200).json({
    success: true,
    message: "User account has been deactivated (soft deleted).",
  });
});

exports.getTotalCustomers = asyncHandler(async (req, res) => {
  const total = await userService.getTotalCustomersCount();

  res.status(200).json({
    success: true,
    data: total, // Standardized to return in the 'data' envelope
  });
});