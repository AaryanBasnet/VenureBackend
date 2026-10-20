const express = require("express");
const router = express.Router();

const controller = require("../controller/venueApplicationController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { venueApplicationFiles } = require("../middleware/uploadMiddleware");
const { applicationLimiter, applicationCheckLimiter } = require("../middleware/rateLimiters");
const {
  rejectApplicationSchema,
  checkEmailSchema,
  listApplicationsSchema,
} = require("../validators/venueApplicationValidators");

/* Public: anyone can apply (there is no account yet). Limited per address because every request stores files. */
router.post("/", applicationLimiter, venueApplicationFiles(), controller.submit);
router.post("/check-email", applicationCheckLimiter, validate(checkEmailSchema), controller.checkEmail);

/* Admin: review */
router.use(protectRoute, authorizeRoles("Admin"));
router.get("/", validate(listApplicationsSchema, "query"), controller.list);
router.get("/:id", controller.get);
router.get("/:id/documents/:kind/link", controller.documentLink);
router.post("/:id/approve", controller.approve);
router.post("/:id/resend-link", controller.resendLink);
router.post("/:id/reject", validate(rejectApplicationSchema), controller.reject);

module.exports = router;
