const express = require("express");
const router = express.Router();

const spaceController = require("../controller/spaceController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { spaceImages } = require("../middleware/uploadMiddleware");
const { updateSpaceSchema, removeSpaceImageSchema } = require("../validators/spaceValidators");

// Nested creation/listing lives at /api/venues/:venueId/spaces (route/venueRoutes.js).
// These operate on a space directly by its own id.
router.use(protectRoute, authorizeRoles("VenueOwner"));

router.put("/:id", validate(updateSpaceSchema), spaceController.updateSpace);
router.post("/:id/images", spaceController.assertCanAddImages, spaceImages(), spaceController.addImages);
router.delete("/:id/images", validate(removeSpaceImageSchema), spaceController.removeImage);
router.delete("/:id", spaceController.deactivateSpace);

module.exports = router;
