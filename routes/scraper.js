const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');

router.post('/search', scraperController.searchGoogleMaps);
router.post('/search-rapid', scraperController.searchGoogleMapsRapidAPI);
router.get('/stored-data', scraperController.getStoredBusinesses);

// Dataset Marketplace Routes
router.get('/admin/datasets', scraperController.getAdminDatasets);
router.get('/admin/filter-options', scraperController.getDatasetFilterOptions);
router.get('/admin/stats', scraperController.getAdminStats);
router.get('/admin/dataset-preview', scraperController.getDatasetPreview);
router.get('/dataset/search', scraperController.getDatasetSearchParams);
router.get('/dataset/global-stats', scraperController.getGlobalDatasetStats);

router.post('/dataset/update-price', scraperController.updateDatasetPrice);
router.post('/dataset/bulk-update-price', scraperController.bulkUpdatePrice);

router.get('/dataset/:id', scraperController.getDatasetDetail);
router.post('/dataset/purchase', scraperController.purchaseDataset);

module.exports = router;
