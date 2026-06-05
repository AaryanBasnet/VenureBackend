const express = require("express");
const router = express.Router();
const adminDashboardController = require("../controller/adminDashboardController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");

// Security: Every single route in this file requires Admin privileges
router.use(protectRoute, authorizeRoles("Admin"));

// GET /api/admin/dashboard/activity-logs
router.get("/activity-logs", adminDashboardController.getAllActivityLogs);

// GET /api/admin/dashboard/earnings/monthly
router.get("/earnings/monthly", adminDashboardController.getTotalMonthlyEarningsAllOwners);

module.exports = router;