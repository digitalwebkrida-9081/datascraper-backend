const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    content: {
      type: String,
      required: true,
    },
    metaTitle: {
      type: String,
    },
    metaDescription: {
      type: String,
    },
    metaKeywords: {
      type: String,
    },
    canonicalUrl: {
      type: String,
    },
    focusKeyword: {
      type: String,
    },
    altText: {
      type: String,
    },
    schemaMarkup: {
      type: String,
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    imageUrl: {
      type: String,
    },
    category: {
      type: String,
      default: "Uncategorized",
    },
    author: {
      type: String,
      default: "Admin",
    },
    readTime: {
      type: String,
      default: "5 min read",
    },
    excerpt: {
      type: String,
      default: "",
    },
    featured: {
      type: Boolean,
      default: false,
    },
    gradient: {
      type: String,
      default: "from-blue-600 to-indigo-600",
    },
    icon: {
      type: String,
      default: "📄",
    },
    showCta: {
      type: Boolean,
      default: false,
    },
    ctaText: {
      type: String,
      default:
        "Need Custom Data? Get high-quality scraped data tailored to your business needs.",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Post", postSchema);
