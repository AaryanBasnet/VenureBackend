const express = require("express");
const router = express.Router();
const contactController = require("../controller/contactController");

const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { submitContactSchema } = require("../validators/contactValidators");

/* =========================================================================
   PUBLIC ROUTES
========================================================================= */
// Users do not need to be logged in to contact you
router.post(
  "/", 
  validate(submitContactSchema, "body"), 
  contactController.submitContactForm
);

/* =========================================================================
   PROTECTED ROUTES
========================================================================= */
// Only Admins can view the submitted forms
router.get(
  "/admin/all", 
  protectRoute, 
  authorizeRoles("Admin"), 
  contactController.getAllContactSubmissions
);

module.exports = router;