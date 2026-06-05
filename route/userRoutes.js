const express = require("express");
const router = express.Router();
const userController = require("../controller/userController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { profileImage } = require("../middleware/uploadMiddleware");
const { updateUserSchema, adminUserQuerySchema } = require("../validators/userValidators");

// All routes in this file require the user to be logged in
router.use(protectRoute);

/* =========================================================================
   CUSTOMER / OWNER ROUTES (Profile Management)
========================================================================= */
// View own profile
router.get("/profile", userController.getUserProfile);

// Update own profile (with Cloudinary avatar upload)
router.put(
  "/profile",
  profileImage(), 
  validate(updateUserSchema, "body"), 
  userController.updateUserProfile
);

/* =========================================================================
   ADMIN ROUTES (User Management)
========================================================================= */
// Admin Dashboard stats (Total Customers)
router.get(
  "/admin/customers/total", 
  authorizeRoles("Admin"), 
  userController.getTotalCustomers
);

// Get all users with filters & pagination
router.get(
  "/admin/all", 
  authorizeRoles("Admin"), 
  validate(adminUserQuerySchema, "query"), 
  userController.getAllUsers
);

// Get a specific user's details
router.get(
  "/admin/:id", 
  authorizeRoles("Admin"), 
  userController.getOneUser
);

// Soft delete (deactivate) a user
router.delete(
  "/admin/:id", 
  authorizeRoles("Admin"), 
  userController.deleteUser
);

module.exports = router;