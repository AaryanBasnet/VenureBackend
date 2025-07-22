const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  verifyPassword,
} = require("../controller/authController");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-password", verifyPassword);

module.exports = router;
