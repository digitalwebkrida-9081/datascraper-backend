const express = require('express');
const router = express.Router();
const currencyController = require('../controllers/currencyController');

// GET /api/currency/rate — returns user's local currency + live exchange rate
router.get('/rate', currencyController.getExchangeRate);

module.exports = router;
