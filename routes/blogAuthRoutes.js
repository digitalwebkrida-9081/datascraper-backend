const express = require("express");
const jwt = require("jsonwebtoken");
const BlogAdmin = require("../models/BlogAdmin");
const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || "fallback_secret", {
    expiresIn: "30d",
  });
};

// Login Route for Blog Admin
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const admin = await BlogAdmin.findOne({ username: username.toLowerCase() });

    if (admin && admin.password === password) {
      res.json({
        _id: admin._id,
        username: admin.username,
        token: generateToken(admin._id),
      });
    } else {
      res.status(401).json({ message: "Invalid username or password" });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
