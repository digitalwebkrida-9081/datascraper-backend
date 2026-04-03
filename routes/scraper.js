const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');
const authMiddleware = require('../middleware/auth');

router.post('/search', scraperController.searchGoogleMaps);
router.post('/search-rapid', scraperController.searchGoogleMapsRapidAPI);
router.get('/stored-data', scraperController.getStoredBusinesses);

// Dataset Marketplace Routes
// Dataset Marketplace Routes
router.get('/admin/datasets', authMiddleware, scraperController.getAdminDatasets);
router.get('/admin/filter-options', authMiddleware, scraperController.getDatasetFilterOptions);
router.get('/admin/stats', authMiddleware, scraperController.getAdminStats);
router.get('/admin/dataset-preview', authMiddleware, scraperController.getDatasetPreview);
router.get('/dataset/search', scraperController.getDatasetSearchParams);
router.get('/dataset/global-stats', scraperController.getGlobalDatasetStats);

router.post('/dataset/update-price', authMiddleware, scraperController.updateDatasetPrice);
router.post('/dataset/bulk-update-price', authMiddleware, scraperController.bulkUpdatePrice);

router.get('/dataset/:id', scraperController.getDatasetDetail);
router.post('/dataset/purchase', scraperController.purchaseDataset);

module.exports = router;
