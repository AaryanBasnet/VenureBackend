const User = require("../model/user");
const jwt = require("jsonwebtoken");

exports.authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  try {
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return res.status(401).json({ success: false, msg: "Access Denied" });
    }
    const token = authHeader.split(" ")[1];
    const verifyToken = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: verifyToken._id });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Token mismatch" });
    }
    req.user = user;
    next();
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, msg: "Internal Server Error" });
  }
};

exports.isAdmin = async (req, res, next) => {
  if (req.user && req.user.role === "Admin") {
    next();
  } else {
    return res
      .status(403)
      .json({ success: false, message: "Admin privilage required" });
  }
};
