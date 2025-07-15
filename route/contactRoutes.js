// routes/contactRoutes.js
const express = require("express");
const router = express.Router();
const { submitContactForm , getAllContactSubmissions} = require("../controller/contactController");
const { authenticateUser, isAdmin } = require("../middleware/authorizedUser");

router.post("/", submitContactForm);

router.get("/admin", authenticateUser, isAdmin, getAllContactSubmissions);

module.exports = router;
