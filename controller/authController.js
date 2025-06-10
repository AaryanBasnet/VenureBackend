const User = require("../model/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const registerUser = async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "User Already exists" });
    }

    const hasedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hasedPassword,
      role,
      phone,
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      message: "User registered succesfully",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = registerUser;
