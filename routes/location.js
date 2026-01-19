const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

// Import locations (States & Cities)
router.post('/import', locationController.importLocations);

// Get States
router.get('/states', locationController.getStates);

// Get Cities for a State
router.get('/cities/:stateCode', locationController.getCities);

module.exports = router;
