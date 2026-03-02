const express = require("express");
const router = express.Router();
const blogController = require("../controllers/blog");

// Public route -> Get all blogs
router.get("/", blogController.getAllBlogs);

// Public route -> Get single blog by slug
router.get("/slug/:slug", blogController.getBlogBySlug);

// Admin route -> Get single blog by ID
router.get("/:id", blogController.getBlogById);

// Admin route -> Create new blog
router.post("/", blogController.createBlog);

// Admin route -> Update existing blog
router.put("/:id", blogController.updateBlog);

// Admin route -> Delete blog
router.delete("/:id", blogController.deleteBlog);

module.exports = router;
