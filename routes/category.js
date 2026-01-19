const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

// Import categories
router.post('/import', categoryController.importCategories);

// Get all categories
router.get('/', categoryController.getCategories);

module.exports = router;
