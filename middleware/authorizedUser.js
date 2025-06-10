const jwt = require("jsonwebtoken");
const user = require("../model/user");

exports.authenticateUser = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please Provide a valid token",
      });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or token is invalid",
      });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server Authentication error",
    });
  }
};
