const express = require('express');
const router = express.Router();
const axios = require('axios');

// Rocky VPS Data API URL (internal, HTTP is fine server-to-server)
const DATA_API_URL = process.env.DATA_API_URL || 'http://51.210.109.205:7070';

// Proxy GET requests to the Rocky VPS Data API
const proxyGet = async (req, res) => {
    try {
        const targetUrl = `${DATA_API_URL}${req.originalUrl}`;
        console.log(`[Proxy] GET → ${targetUrl}`);
        
        // Stats/browse/categories-count endpoints scan files, need more time
        const timeout = (req.path.includes('stats') || req.path.includes('browse') || req.path.includes('categories-count')) ? 120000 : 30000;
        const response = await axios.get(targetUrl, { timeout });
        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        res.status(error.response?.status || 502).json({
            success: false,
            message: 'Failed to fetch data from data server',
            error: error.message
        });
    }
};

// Proxy POST requests to the Rocky VPS Data API
const proxyPost = async (req, res) => {
    try {
        const targetUrl = `${DATA_API_URL}${req.originalUrl}`;
        console.log(`[Proxy] POST → ${targetUrl}`);
        
        const response = await axios.post(targetUrl, req.body, { timeout: 30000 });
        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        res.status(error.response?.status || 502).json({
            success: false,
            message: 'Failed to update data on data server',
            error: error.message
        });
    }
};

// GET routes
router.get('/countries', proxyGet);
router.get('/categories', proxyGet);
router.get('/categories-count', proxyGet);
router.get('/data', proxyGet);
router.get('/stats', proxyGet);
router.get('/browse', proxyGet);
router.get('/preview', proxyGet);

// POST routes
router.post('/update-price', proxyPost);
router.post('/bulk-update-price', proxyPost);

module.exports = router;
