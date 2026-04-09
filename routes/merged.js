const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/auth');

// Rocky VPS Data API URL (internal, HTTP is fine server-to-server)
const DATA_API_URL = process.env.DATA_API_URL || 'http://51.210.109.205:7070';

// Proxy GET requests to the Rocky VPS Data API
const proxyGet = async (req, res) => {
    try {
        const baseURL = DATA_API_URL.replace(/\/$/, '');
        const targetUrl = `${baseURL}${req.originalUrl}`;
        console.log(`[Proxy] GET → ${targetUrl}`);
        
        // Stats/browse/categories-count endpoints scan files, need more time
        const timeout = (req.path.includes('stats') || req.path.includes('browse') || req.path.includes('categories-count')) ? 120000 : 30000;
        const response = await axios.get(targetUrl, { timeout });
        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        if (error.response) {
            console.error('[Proxy] Error Data:', JSON.stringify(error.response.data));
            console.error('[Proxy] Target URL:', `${DATA_API_URL}${req.originalUrl}`);
        }
        res.status(error.response?.status || 502).json({
            success: false,
            message: 'Failed to fetch data from data server',
            error: error.message,
            details: error.response?.data
        });
    }
};

// Proxy POST requests to the Rocky VPS Data API
const proxyPost = async (req, res) => {
    try {
        const baseURL = DATA_API_URL.replace(/\/$/, '');
        const targetUrl = `${baseURL}${req.originalUrl}`;
        console.log(`[Proxy] POST → ${targetUrl}`);
        
        const response = await axios.post(targetUrl, req.body, { timeout: 30000 });
        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        if (error.response) {
            console.error('[Proxy] Error Data:', JSON.stringify(error.response.data));
            console.error('[Proxy] Target URL:', `${DATA_API_URL}${req.originalUrl}`);
        }
        res.status(error.response?.status || 502).json({
            success: false,
            message: 'Failed to update data on data server',
            error: error.message,
            details: error.response?.data
        });
    }
};

// Proxy file download (streams binary response for CSV downloads)
const proxyDownload = async (req, res) => {
    try {
        const baseURL = DATA_API_URL.replace(/\/$/, '');
        const targetUrl = `${baseURL}${req.originalUrl}`;
        console.log(`[Proxy] DOWNLOAD → ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            timeout: 60000,
            responseType: 'stream'
        });
        
        // Forward all headers from the data API (Content-Type, Content-Disposition, etc.)
        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-disposition']) res.setHeader('Content-Disposition', response.headers['content-disposition']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        
        // Pipe the file stream directly to the client
        response.data.pipe(res);
    } catch (error) {
        console.error('[Proxy] Download Error:', error.message);
        // If it's a JSON error response from the data API, forward it
        if (error.response?.headers?.['content-type']?.includes('application/json')) {
            try {
                let errorData = '';
                error.response.data.on('data', chunk => errorData += chunk);
                error.response.data.on('end', () => {
                    try {
                        res.status(error.response.status).json(JSON.parse(errorData));
                    } catch {
                        res.status(error.response.status).json({ success: false, message: 'Download failed' });
                    }
                });
                return;
            } catch {}
        }
        res.status(error.response?.status || 502).json({
            success: false,
            message: 'Failed to download sample from data server',
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
router.get('/download-sample', proxyDownload);

// POST routes
router.post('/update-price', authMiddleware, proxyPost);
router.post('/bulk-update-price', authMiddleware, proxyPost);
router.post('/update-records', authMiddleware, proxyPost);
router.post('/delete-records', authMiddleware, proxyPost);

module.exports = router;
