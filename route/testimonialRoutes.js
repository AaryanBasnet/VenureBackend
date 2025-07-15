const express = require("express");
const router = express.Router();
const {
  createTestimonial,
  getAllTestimonials,
  getTopTestimonial,
  getBookedVenuesForTestimonial,
} = require("../controller/testimonialController");

const { authenticateUser } = require("../middleware/authorizedUser");

router.post("/", authenticateUser, createTestimonial);
router.get("/my-venues", authenticateUser, getBookedVenuesForTestimonial);
router.get("/highest-rated", getTopTestimonial);
router.get("/admin", authenticateUser, getAllTestimonials);

module.exports = router;
