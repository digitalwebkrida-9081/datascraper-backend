const express = require('express');
const router = express.Router();
const axios = require('axios');

// Rocky VPS Data API URL (internal, HTTP is fine server-to-server)
const DATA_API_URL = process.env.DATA_API_URL || 'http://51.210.109.205:7070';

// Proxy all /api/merged/* requests to the Rocky VPS Data API
const proxyRequest = async (req, res) => {
    try {
        const targetUrl = `${DATA_API_URL}${req.originalUrl}`;
        console.log(`[Proxy] → ${targetUrl}`);
        
        // Stats endpoint scans thousands of files, needs more time
        const timeout = req.path.includes('stats') ? 120000 : 30000;
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

router.get('/countries', proxyRequest);
router.get('/categories', proxyRequest);
router.get('/data', proxyRequest);
router.get('/stats', proxyRequest);

module.exports = router;
