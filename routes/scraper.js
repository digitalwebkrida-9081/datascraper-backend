const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');

router.post('/search', scraperController.searchGoogleMaps);
router.post('/search-rapid', scraperController.searchGoogleMapsRapidAPI);
router.get('/stored-data', scraperController.getStoredBusinesses);

// Dataset Marketplace Routes
router.get('/dataset/search', scraperController.getDatasetSearchParams);
router.get('/dataset/:id', scraperController.getDatasetDetail);
router.post('/dataset/purchase', scraperController.purchaseDataset);

module.exports = router;
