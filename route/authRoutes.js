const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  verifyPassword,

  forgotPassword,
  verifyResetCode,
  resetPasswordWithCode,
} = require("../controller/authController");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-password", verifyPassword);
router.post("/forgot-password", forgotPassword);

router.post("/verify-reset-code",verifyResetCode )
router.post("/reset-password", resetPasswordWithCode);


module.exports = router;
