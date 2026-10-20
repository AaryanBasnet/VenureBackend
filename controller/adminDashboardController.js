const { isDemoAdmin } = require("../services/demoScope");
const asyncHandler = require("../utils/asyncHandler");
const adminDashboardService = require("../services/adminDashboardService");

exports.getAllActivityLogs = asyncHandler(async (req, res) => {
  const logs = await adminDashboardService.getRecentActivityLogs(undefined, isDemoAdmin(req.user));
  
  res.status(200).json({ 
    success: true, 
    data: logs 
  });
});

exports.getTotalMonthlyEarningsAllOwners = asyncHandler(async (req, res) => {
  const earnings = await adminDashboardService.getGlobalMonthlyEarnings(isDemoAdmin(req.user));
  
  res.status(200).json({ 
    success: true, 
    data: earnings 
  });
});