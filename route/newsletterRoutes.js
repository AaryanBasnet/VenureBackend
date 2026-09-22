const express = require("express");
const router = express.Router();

const newsletterController = require("../controller/newsletterController");
const validate = require("../middleware/validate");
const { subscribeSchema } = require("../validators/newsletterValidators");
const { newsletterLimiter } = require("../middleware/rateLimiters");

/* =========================================================================
   PUBLIC ROUTES
========================================================================= */
router.post(
  "/",
  newsletterLimiter,
  validate(subscribeSchema, "body"),
  newsletterController.subscribe
);

module.exports = router;
