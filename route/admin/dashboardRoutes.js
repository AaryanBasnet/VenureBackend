const express = require("express");
const router = express.Router();
const { getAllActivityLogs , getTotalMonthlyEarningsAllOwners} = require("../../controller/admin/adminDashboardController");
const { authenticateUser, isAdmin } = require("../../middleware/authorizedUser");

// Optional: protect route with admin middleware
router.get("/activity/logs", getAllActivityLogs);

router.get("/earnings/monthly", authenticateUser, getTotalMonthlyEarningsAllOwners);

module.exports = router;
