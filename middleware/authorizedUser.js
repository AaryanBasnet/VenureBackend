const jwt = require("jsonwebtoken");
const User = require("../model/user");

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

exports.getOneUser = async (req, res) => {
    try{    
        const _id = req.params.id // use mongo id
        const user = await User.findById(_id)
        return res.status(200).json(
            {
                "success": true,
                "message": "One user fetched",
                "data": user
            }
        )
    }catch(err){
        return res.status(500).json(
            {"success": false, "message": "Server Error"}
        )
    }
}
