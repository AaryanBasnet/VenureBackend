const express = require("express");
const router = express.Router();

// Controllers
const venueController = require("../controller/venueController");

// Security & Middlewares
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { venueImages } = require("../middleware/uploadMiddleware");

// Validations
const { createVenueSchema, searchVenuesSchema, updateVenueSchema } = require("../validators/venueValidators");

/* =========================================================================
   PUBLIC / DISCOVERY ROUTES (No auth required to browse venues)
========================================================================= */
// GET /api/venues?city=London&radius=10
router.get(
  "/", 
  validate(searchVenuesSchema, "query"), 
  venueController.getAllApprovedVenues
);

// GET /api/venues/:id
router.get("/:id", venueController.getVenueById);


/* =========================================================================
   VENUE OWNER ROUTES (Requires Authentication & "VenueOwner" Role)
========================================================================= */
// Protect all routes below this line
router.use(protectRoute);

// Owner Dashboards
router.get(
  "/owner/me", 
  authorizeRoles("VenueOwner"), 
  venueController.getVenuesByOwner
);

router.get(
  "/owner/approved-count", 
  authorizeRoles("VenueOwner"), 
  venueController.getApprovedVenueCountByOwner
);

// Owner Mutations
router.post(
  "/",
  authorizeRoles("VenueOwner"),
  validate(createVenueSchema, "body"),
  venueController.createVenue
);

router.post(
  "/:id/images",
  authorizeRoles("VenueOwner"),
  venueImages(10), // Cloudinary Multer execution
  venueController.uploadVenueImages
);

router.put(
  "/:id",
  authorizeRoles("VenueOwner"),
  venueImages(10),
  validate(updateVenueSchema, "body"),
  venueController.updateVenue
);

router.delete(
  "/:id",
  authorizeRoles("VenueOwner", "Admin"), // Admins can also delete
  venueController.deleteVenue
);


/* =========================================================================
   ADMIN ROUTES (Requires "Admin" Role)
========================================================================= */
// Admin Dashboards
router.get(
  "/admin/all", 
  authorizeRoles("Admin"), 
  venueController.getAllVenues
);

router.get(
  "/admin/approved-count", 
  authorizeRoles("Admin"), 
  venueController.getApprovedVenueCount
);

// Admin Mutations
router.patch(
  "/:id/status",
  authorizeRoles("Admin"),
  venueController.updateVenueStatus
);

module.exports = router;