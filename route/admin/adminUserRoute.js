const express = require("express");
const router = express.Router();

const {
  getUsers,
  getOneUser,
  deleteUser,
  getTotalCustomers,
} = require("../../controller/admin/userManagement");

const {
  authenticateUser,
  isAdmin,
} = require("../../middleware/authorizedUser");

// ✅ Define specific routes first
router.get("/getAll", authenticateUser, isAdmin, getUsers);
router.get("/getCustomerCount", getTotalCustomers);

// ✅ Define dynamic route last
router.get("/:id", getOneUser);
router.delete("/:id", deleteUser);

module.exports = router;
