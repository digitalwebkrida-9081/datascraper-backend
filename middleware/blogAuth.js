const jwt = require("jsonwebtoken");
const BlogAdmin = require("../models/BlogAdmin");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "fallback_secret",
      );
      // Blog admin uses BlogAdmin model
      req.admin = await BlogAdmin.findById(decoded.id).select("-password");
      if (!req.admin) {
         return res.status(401).json({ message: "Not authorized as blog admin" });
      }
      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: "Not authorized, token failed" });
    }
  } else {
    res.status(401).json({ message: "Not authorized, no token" });
  }
};

module.exports = { protect };
