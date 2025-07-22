const express = require("express");
const router = express.Router();
const { createPaymentIntent } = require("../controller/paymentController");
const { authenticateUser } = require("../middleware/authorizedUser");

router.post("/create-payment-intent", authenticateUser, createPaymentIntent);

module.exports = router;
