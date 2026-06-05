const express = require("express");
const router = express.Router();

const notificationController = require("../controller/notificationController");
const { protectRoute } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { notificationIdSchema } = require("../validators/notificationValidators");

// All notification routes require authentication
router.use(protectRoute);

/* =========================================================================
   GENERAL ROUTES 
========================================================================= */
router.get("/", notificationController.getNotifications);
router.patch("/read-all", notificationController.markAllAsRead);

/* =========================================================================
   DYNAMIC ID ROUTES
========================================================================= */
router.patch(
  "/:id/read", 
  validate(notificationIdSchema, "params"), // Targets req.params instead of req.body
  notificationController.markAsRead
);

router.delete(
  "/:id", 
  validate(notificationIdSchema, "params"), 
  notificationController.deleteNotification
);

module.exports = router;