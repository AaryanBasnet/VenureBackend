const express = require("express");
const router = express.Router();

const spaceController = require("../controller/spaceController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { updateSpaceSchema } = require("../validators/spaceValidators");

// Nested creation/listing lives at /api/venues/:venueId/spaces (route/venueRoutes.js).
// These operate on a space directly by its own id.
router.use(protectRoute, authorizeRoles("VenueOwner"));

router.put("/:id", validate(updateSpaceSchema), spaceController.updateSpace);
router.delete("/:id", spaceController.deactivateSpace);

module.exports = router;
