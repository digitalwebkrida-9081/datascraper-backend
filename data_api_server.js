const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
const PORT = 7070;

// ==========================================
// CONFIGURATION
// ==========================================
// Base path where merged data folders live (US_Merged, UK_Merged, etc.)
const MERGED_DATA_BASE = __dirname; // Same directory as this server.js

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({ origin: '*', methods: ['GET'] }));
app.use(express.json());

// ==========================================
// HELPERS
// ==========================================

function getMergedDir(countryCode) {
    return path.join(MERGED_DATA_BASE, `${countryCode.toUpperCase()}_Merged`);
}

function formatCategoryName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function getCountryName(code) {
    const countries = {
        'US': 'United States', 'UK': 'United Kingdom', 'CA': 'Canada',
        'AU': 'Australia', 'IN': 'India', 'DE': 'Germany',
        'FR': 'France', 'JP': 'Japan', 'BR': 'Brazil', 'MX': 'Mexico'
    };
    return countries[code.toUpperCase()] || code.toUpperCase();
}

// Quick line count (counts newlines without parsing CSV)
function quickLineCount(filePath) {
    return new Promise((resolve, reject) => {
        let lineCount = 0;
        fs.createReadStream(filePath)
            .on('data', (buffer) => {
                let idx = -1;
                lineCount--;
                do { idx = buffer.indexOf(10, idx + 1); lineCount++; } while (idx !== -1);
            })
            .on('end', () => resolve(Math.max(0, lineCount)))
            .on('error', (err) => reject(err));
    });
}

// Read CSV with pagination and optional search
function readCsvPaginated(filePath, page = 1, limit = 20, search = '') {
    return new Promise((resolve, reject) => {
        const allMatching = [];
        const lowerSearch = search.toLowerCase();

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                if (search) {
                    const matches = Object.values(row).some(val =>
                        (val || '').toString().toLowerCase().includes(lowerSearch)
                    );
                    if (matches) allMatching.push(row);
                } else {
                    allMatching.push(row);
                }
            })
            .on('end', () => {
                const total = allMatching.length;
                const totalPages = Math.ceil(total / limit);
                const skip = (page - 1) * limit;
                const paginatedData = allMatching.slice(skip, skip + limit);
                resolve({ data: paginatedData, pagination: { total, page, limit, totalPages } });
            })
            .on('error', (err) => reject(err));
    });
}

// ==========================================
// API ENDPOINTS
// ==========================================

// GET /api/merged/countries — List available countries
app.get('/api/merged/countries', (req, res) => {
    try {
        const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
        const countries = items
            .filter(item => item.isDirectory() && item.name.endsWith('_Merged'))
            .map(item => {
                const code = item.name.replace('_Merged', '');
                const mergedDir = path.join(MERGED_DATA_BASE, item.name);
                const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
                return {
                    code,
                    name: getCountryName(code),
                    totalCategories: csvFiles.length,
                    folderName: item.name
                };
            });

        res.json({ success: true, message: 'Countries fetched', data: { countries } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/merged/categories?country=US — List categories for a country
app.get('/api/merged/categories', (req, res) => {
    try {
        const { country } = req.query;
        if (!country) return res.status(400).json({ success: false, message: 'Country parameter is required' });

        const mergedDir = getMergedDir(country);
        if (!fs.existsSync(mergedDir)) return res.status(404).json({ success: false, message: `No data for: ${country}` });

        const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
        const categories = csvFiles.map(file => {
            const categoryName = file.replace('.csv', '');
            const stat = fs.statSync(path.join(mergedDir, file));
            return {
                name: categoryName,
                displayName: formatCategoryName(categoryName),
                fileName: file,
                fileSize: stat.size,
                fileSizeFormatted: formatFileSize(stat.size),
                lastModified: stat.mtime
            };
        }).sort((a, b) => a.displayName.localeCompare(b.displayName));

        res.json({
            success: true,
            message: 'Categories fetched',
            data: { country: country.toUpperCase(), totalCategories: categories.length, categories }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/merged/data?country=US&category=schools&page=1&limit=20&search=xyz
app.get('/api/merged/data', async (req, res) => {
    try {
        const { country, category, page = 1, limit = 20, search = '' } = req.query;
        if (!country || !category) return res.status(400).json({ success: false, message: 'Country and category required' });

        const filePath = path.join(getMergedDir(country), `${category}.csv`);
        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: `Data not found: ${category} in ${country}` });

        const result = await readCsvPaginated(filePath, parseInt(page), parseInt(limit), search);

        res.json({
            success: true,
            message: 'Data fetched',
            data: { country: country.toUpperCase(), category: formatCategoryName(category), ...result }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/merged/stats — Summary stats across all countries
app.get('/api/merged/stats', async (req, res) => {
    try {
        const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
        const mergedFolders = items.filter(item => item.isDirectory() && item.name.endsWith('_Merged'));

        let totalRecords = 0;
        let totalCategories = 0;
        const countryStats = [];

        for (const folder of mergedFolders) {
            const countryCode = folder.name.replace('_Merged', '');
            const mergedDir = path.join(MERGED_DATA_BASE, folder.name);
            const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));

            let countryRecords = 0;
            let countryTotalSize = 0;
            const categoryList = [];

            for (const file of csvFiles) {
                const filePath = path.join(mergedDir, file);
                const stat = fs.statSync(filePath);
                const lineCount = await quickLineCount(filePath);

                countryRecords += lineCount;
                countryTotalSize += stat.size;
                categoryList.push({
                    name: formatCategoryName(file.replace('.csv', '')),
                    records: lineCount,
                    fileSize: formatFileSize(stat.size)
                });
            }

            totalRecords += countryRecords;
            totalCategories += csvFiles.length;

            countryStats.push({
                code: countryCode,
                name: getCountryName(countryCode),
                totalRecords: countryRecords,
                totalCategories: csvFiles.length,
                totalSize: formatFileSize(countryTotalSize),
                topCategories: categoryList.sort((a, b) => b.records - a.records).slice(0, 10)
            });
        }

        res.json({
            success: true,
            message: 'Stats fetched',
            data: {
                summary: { totalCountries: mergedFolders.length, totalCategories, totalRecords },
                countries: countryStats
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Merged Data API running on port ${PORT}`);
    console.log(`   Base data path: ${MERGED_DATA_BASE}`);
    console.log(`\n📡 Endpoints:`);
    console.log(`   GET http://0.0.0.0:${PORT}/api/merged/countries`);
    console.log(`   GET http://0.0.0.0:${PORT}/api/merged/categories?country=US`);
    console.log(`   GET http://0.0.0.0:${PORT}/api/merged/data?country=US&category=schools&page=1&limit=20`);
    console.log(`   GET http://0.0.0.0:${PORT}/api/merged/stats`);
    console.log(`   GET http://0.0.0.0:${PORT}/health\n`);
});
