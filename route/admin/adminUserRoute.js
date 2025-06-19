const express = require("express");
const router = express.Router();

const { getUsers, getOneUser } = require("../../controller/admin/userManagement");

const {
  authenticateUser,
  isAdmin,
} = require("../../middleware/authorizedUser");

router.get("/getAll", authenticateUser, isAdmin, getUsers);

router.get(
    "/:id", // req.params.id
    getOneUser
)

module.exports = router