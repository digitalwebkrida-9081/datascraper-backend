const Blog = require("../models/Blog");
const {
  successResponse,
  errorResponse,
} = require("../common/helper/responseHelper");

// Get all blogs
exports.getAllBlogs = async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ createdAt: -1 });
    return successResponse(res, blogs, "Blogs fetched successfully");
  } catch (error) {
    return errorResponse(res, "Failed to fetch blogs", 500, error.message);
  }
};

// Get single blog by slug
exports.getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (!blog) return errorResponse(res, "Blog not found", 404);
    return successResponse(res, blog, "Blog fetched successfully");
  } catch (error) {
    return errorResponse(res, "Failed to fetch blog", 500, error.message);
  }
};

// Get single blog by ID
exports.getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return errorResponse(res, "Blog not found", 404);
    return successResponse(res, blog, "Blog fetched successfully");
  } catch (error) {
    return errorResponse(res, "Failed to fetch blog", 500, error.message);
  }
};

// Create a blog
exports.createBlog = async (req, res) => {
  try {
    const {
      title,
      slug,
      content,
      metaTitle,
      metaDescription,
      metaKeywords,
      coverImage,
      status,
    } = req.body;

    // Check if slug already exists
    const existing = await Blog.findOne({ slug });
    if (existing) {
      return errorResponse(res, "Blog with this slug already exists", 400);
    }

    const blog = new Blog({
      title,
      slug,
      content,
      metaTitle,
      metaDescription,
      metaKeywords,
      coverImage,
      status,
    });

    await blog.save();
    return successResponse(res, blog, "Blog created successfully", 201);
  } catch (error) {
    return errorResponse(res, "Failed to create blog", 500, error.message);
  }
};

// Update a blog
exports.updateBlog = async (req, res) => {
  try {
    const {
      title,
      slug,
      content,
      metaTitle,
      metaDescription,
      metaKeywords,
      coverImage,
      status,
    } = req.body;

    const blog = await Blog.findById(req.params.id);
    if (!blog) return errorResponse(res, "Blog not found", 404);

    if (slug && slug !== blog.slug) {
      const existing = await Blog.findOne({ slug });
      if (existing) {
        return errorResponse(res, "Blog with this slug already exists", 400);
      }
      blog.slug = slug;
    }

    if (title) blog.title = title;
    if (content) blog.content = content;
    if (metaTitle) blog.metaTitle = metaTitle;
    if (metaDescription) blog.metaDescription = metaDescription;
    if (metaKeywords) blog.metaKeywords = metaKeywords;
    if (coverImage) blog.coverImage = coverImage;
    if (status) blog.status = status;

    await blog.save();
    return successResponse(res, blog, "Blog updated successfully");
  } catch (error) {
    return errorResponse(res, "Failed to update blog", 500, error.message);
  }
};

// Delete a blog
exports.deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) return errorResponse(res, "Blog not found", 404);

    return successResponse(res, {}, "Blog deleted successfully");
  } catch (error) {
    return errorResponse(res, "Failed to delete blog", 500, error.message);
  }
};
