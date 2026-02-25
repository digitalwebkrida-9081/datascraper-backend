const express = require('express');
const router = express.Router();
const mergedDataController = require('../controllers/mergedDataController');

// List all available countries with merged data
router.get('/countries', mergedDataController.getCountries);

// List categories for a specific country
router.get('/categories', mergedDataController.getCategories);

// Get paginated data for a specific country + category
router.get('/data', mergedDataController.getMergedData);

// Get summary stats across all countries
router.get('/stats', mergedDataController.getMergedStats);

module.exports = router;
