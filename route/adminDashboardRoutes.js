const express = require("express");
const router = express.Router();
const reviewController = require("../controller/reviewController");
const validate = require("../middleware/validate");
const { adminReviewQuerySchema } = require("../validators/reviewValidators");
const adminDashboardController = require("../controller/adminDashboardController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");

// Security: Every single route in this file requires Admin privileges
router.use(protectRoute, authorizeRoles("Admin"));

// GET /api/admin/dashboard/activity-logs
router.get("/activity-logs", adminDashboardController.getAllActivityLogs);

// GET /api/admin/dashboard/earnings/monthly
router.get("/earnings/monthly", adminDashboardController.getTotalMonthlyEarningsAllOwners);

// GET /api/admin/reviews?page=&limit=&rating=&featured=&search=
router.get("/reviews", validate(adminReviewQuerySchema, "query"), reviewController.getAdminReviews);

module.exports = router;