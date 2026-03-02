const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Setup multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "blog-image-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

router.post("/", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, msg: "No file uploaded" });
    }

    // React Jodit editor expects the URL of the uploaded image to be returned
    const fileUrl = "/uploads/" + req.file.filename;

    // Based on BlogForm.jsx:
    // isSuccess: function (resp) { return resp && resp.url; }
    // process: function (resp) { return { files: [resp.url], ... } }
    res.json({
      success: true,
      msg: "Image Uploaded Successfully",
      url: fileUrl,
    });
  } catch (error) {
    console.error("Upload error", error);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
