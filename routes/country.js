const express = require('express');
const router = express.Router();
const countryController = require('../controllers/countryController');

// Route to fetch from external API and save to DB
router.post('/add-country', countryController.addCountries);

// Route to get list from DB
router.get('/get-countries', countryController.getCountries);

module.exports = router;
