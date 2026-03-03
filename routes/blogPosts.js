const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const { protect } = require('../middleware/blogAuth');

// Get all posts
router.get("/", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single post by id
router.get("/:id", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create new post
router.post("/", protect, async (req, res) => {
  const post = new Post(req.body);
  try {
    const newPost = await post.save();
    res.status(201).json(newPost);
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.slug) {
        return res.status(400).json({
          message:
            "A post with this slug already exists. Please choose a different title or slug.",
        });
      }
      return res.status(400).json({ message: "Duplicate key error." });
    }
    res.status(400).json({ message: err.message });
  }
});

// Update post
router.put("/:id", protect, async (req, res) => {
  try {
    const updatedPost = await Post.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updatedPost)
      return res.status(404).json({ message: "Post not found" });
    res.json(updatedPost);
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.slug) {
        return res.status(400).json({
          message:
            "A post with this slug already exists. Please choose a different title or slug.",
        });
      }
      return res.status(400).json({ message: "Duplicate key error." });
    }
    res.status(400).json({ message: err.message });
  }
});

// Delete post
router.delete("/:id", protect, async (req, res) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });
    res.json({ message: "Post deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
