const User = require("../../model/user");
const bcrypt = require("bcryptjs");

exports.getUsers = async (req, res) => {
  try {
    console.log(req.user);
    const users = await User.find();
    return res.status(200).json({
      success: true,
      message: "Data fetched",
      data: users,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getOneUser = async (req, res) => {
  try {
    const _id = req.params.id; // use mongo id
    const user = await User.findById(_id);
    return res.status(200).json({
      success: true,
      message: "One user fetched",
      data: user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};



