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

// Read just the CSV header row to detect which data fields exist
function readCsvHeaders(filePath) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        let headerLine = '';
        
        stream.on('data', (chunk) => {
            headerLine += chunk;
            const newlineIdx = headerLine.indexOf('\n');
            if (newlineIdx !== -1) {
                headerLine = headerLine.substring(0, newlineIdx).toLowerCase();
                stream.destroy();
            }
        });
        
        stream.on('close', () => {
            resolve({
                email: headerLine.includes('email'),
                phone: headerLine.includes('phone'),
                website: headerLine.includes('website') || headerLine.includes('url'),
                linkedin: headerLine.includes('linkedin'),
                facebook: headerLine.includes('facebook'),
                instagram: headerLine.includes('instagram'),
                twitter: headerLine.includes('twitter'),
                tiktok: headerLine.includes('tiktok'),
                youtube: headerLine.includes('youtube')
            });
        });
        
        stream.on('error', (err) => reject(err));
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

// GET /api/merged/categories?country=US&page=1&limit=20 — List categories for a country (cached + paginated)
app.get('/api/merged/categories', async (req, res) => {
    try {
        const { country, page = 1, limit = 20 } = req.query;
        if (!country) return res.status(400).json({ success: false, message: 'Country parameter is required' });

        const mergedDir = getMergedDir(country);
        if (!fs.existsSync(mergedDir)) return res.status(404).json({ success: false, message: `No data for: ${country}` });

        const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
        
        // ===== CACHING: compute once, serve instantly =====
        const cacheFile = path.join(mergedDir, `_categories_cache.json`);
        let categories = null;
        
        // Check if cache exists and is still valid (same number of CSV files)
        if (fs.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                if (cached.fileCount === csvFiles.length) {
                    categories = cached.categories;
                    console.log(`[Cache HIT] ${country} — ${categories.length} categories`);
                }
            } catch (e) { /* cache corrupt, rebuild */ }
        }
        
        // Cache miss — compute and save
        if (!categories) {
            console.log(`[Cache MISS] ${country} — computing ${csvFiles.length} categories...`);
            const startTime = Date.now();
            categories = [];

            for (const file of csvFiles) {
                const categoryName = file.replace('.csv', '');
                const filePath = path.join(mergedDir, file);
                const stat = fs.statSync(filePath);

                const [recordCount, hasFields] = await Promise.all([
                    quickLineCount(filePath),
                    readCsvHeaders(filePath)
                ]);

                categories.push({
                    name: categoryName,
                    displayName: formatCategoryName(categoryName),
                    fileName: file,
                    records: recordCount,
                    hasEmail: !!hasFields.email,
                    hasPhone: !!hasFields.phone,
                    hasWebsite: !!hasFields.website,
                    fileSize: stat.size,
                    fileSizeFormatted: formatFileSize(stat.size),
                    lastModified: stat.mtime
                });
            }

            categories.sort((a, b) => a.displayName.localeCompare(b.displayName));
            
            // Save cache
            try {
                fs.writeFileSync(cacheFile, JSON.stringify({ fileCount: csvFiles.length, categories }, null, 0));
                console.log(`[Cache SAVED] ${country} — ${categories.length} categories in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
            } catch (e) { console.error('Cache save error:', e.message); }
        }

        // ===== PAGINATION =====
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = parseInt(limit) || 20;
        const totalCategories = categories.length;
        const totalPages = Math.ceil(totalCategories / limitNum);
        const skip = (pageNum - 1) * limitNum;
        const paginatedCategories = categories.slice(skip, skip + limitNum);

        res.json({
            success: true,
            message: 'Categories fetched',
            data: {
                country: country.toUpperCase(),
                totalCategories,
                categories: paginatedCategories,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    totalPages,
                    totalCategories,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1
                }
            }
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

// ==========================================
// FIELD DETECTION HELPERS
// ==========================================
const FIELD_PATTERNS = {
    email: ['email', 'e-mail', 'email_address', 'contact_email', 'emailaddress'],
    phone: ['phone', 'phone_number', 'telephone', 'tel', 'contact_phone', 'mobile'],
    website: ['website', 'web', 'url', 'site', 'webpage', 'domain'],
    linkedin: ['linkedin', 'linkedin_url'],
    facebook: ['facebook', 'facebook_url', 'fb'],
    instagram: ['instagram', 'instagram_url', 'ig'],
    twitter: ['twitter', 'twitter_url', 'x_url', 'x'],
    tiktok: ['tiktok', 'tiktok_url'],
    youtube: ['youtube', 'youtube_url']
};

function matchesFieldPattern(header, patterns) {
    const h = header.toLowerCase().trim();
    return patterns.some(p => h === p || h.includes(p));
}

// Full CSV scan for accurate counts (used by browse endpoint for individual files)
function scanCsvAccurate(filePath) {
    return new Promise((resolve) => {
        let totalRows = 0;
        const counts = { emails: 0, phones: 0, websites: 0, linkedin: 0, facebook: 0, instagram: 0, twitter: 0, tiktok: 0, youtube: 0 };
        let headerMap = {};

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('headers', (headers) => {
                const lowerHeaders = headers.map(h => h.toLowerCase().trim());
                for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
                    headerMap[fieldType] = lowerHeaders.filter(h => matchesFieldPattern(h, patterns));
                }
            })
            .on('data', (row) => {
                totalRows++;
                const lowerRow = {};
                for (const key of Object.keys(row)) {
                    lowerRow[key.toLowerCase().trim()] = row[key];
                }
                for (const [fieldType, matchedHeaders] of Object.entries(headerMap)) {
                    const countKey = fieldType === 'email' ? 'emails' : fieldType === 'phone' ? 'phones' : fieldType === 'website' ? 'websites' : fieldType;
                    if (matchedHeaders.some(h => lowerRow[h] && lowerRow[h].trim())) {
                        counts[countKey]++;
                    }
                }
            })
            .on('end', () => resolve({ totalRows, ...counts }))
            .on('error', () => resolve({ totalRows: 0, ...counts }));
    });
}

// ==========================================
// FAST HEADER SCANNER (reads only first line)
// ==========================================
function readCsvHeaders(filePath) {
    return new Promise((resolve) => {
        const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        let headerLine = '';
        stream.on('data', (chunk) => {
            headerLine += chunk;
            const newlineIdx = headerLine.indexOf('\n');
            if (newlineIdx !== -1) {
                headerLine = headerLine.substring(0, newlineIdx).trim();
                stream.destroy();
            }
        });
        stream.on('close', () => {
            const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
            // Check which field types exist in headers
            const hasFields = {};
            for (const [fieldType, patterns] of Object.entries(FIELD_PATTERNS)) {
                hasFields[fieldType] = headers.some(h => matchesFieldPattern(h, patterns));
            }
            resolve(hasFields);
        });
        stream.on('error', () => resolve({}));
    });
}

// ==========================================
// STATS ENDPOINT (FAST, CACHED)
// ==========================================

let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

app.get('/api/merged/stats', async (req, res) => {
    try {
        // Force refresh with ?refresh=true
        const forceRefresh = req.query.refresh === 'true';

        // Return cached stats if fresh
        if (!forceRefresh && statsCache && (Date.now() - statsCacheTime) < STATS_CACHE_TTL) {
            console.log('[Stats] Returning cached stats');
            return res.json(statsCache);
        }

        console.log('[Stats] Computing stats (fast mode)...');
        const startTime = Date.now();
        const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
        const mergedFolders = items.filter(item => item.isDirectory() && item.name.endsWith('_Merged'));

        // Global totals
        let globalTotals = {
            totalRecords: 0, totalEmails: 0, totalPhones: 0, totalWebsites: 0,
            totalLinkedin: 0, totalFacebook: 0, totalInstagram: 0,
            totalTwitter: 0, totalTiktok: 0, totalYoutube: 0,
            totalCategories: 0
        };

        const countryStats = [];

        for (const folder of mergedFolders) {
            const countryCode = folder.name.replace('_Merged', '');
            const mergedDir = path.join(MERGED_DATA_BASE, folder.name);
            const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));

            let countryTotals = {
                records: 0, emails: 0, phones: 0, websites: 0,
                linkedin: 0, facebook: 0, instagram: 0,
                twitter: 0, tiktok: 0, youtube: 0,
                totalSize: 0
            };
            const categoryList = [];

            for (const file of csvFiles) {
                const filePath = path.join(mergedDir, file);
                const stat = fs.statSync(filePath);

                // FAST: count lines (not parse CSV) 
                const recordCount = await quickLineCount(filePath);
                // FAST: read only header to check which fields exist
                const hasFields = await readCsvHeaders(filePath);

                // Records from line count
                countryTotals.records += recordCount;
                countryTotals.totalSize += stat.size;

                // If header has email/phone/website columns, count them as available
                if (hasFields.email) countryTotals.emails += recordCount;
                if (hasFields.phone) countryTotals.phones += recordCount;
                if (hasFields.website) countryTotals.websites += recordCount;
                if (hasFields.linkedin) countryTotals.linkedin += recordCount;
                if (hasFields.facebook) countryTotals.facebook += recordCount;
                if (hasFields.instagram) countryTotals.instagram += recordCount;
                if (hasFields.twitter) countryTotals.twitter += recordCount;
                if (hasFields.tiktok) countryTotals.tiktok += recordCount;
                if (hasFields.youtube) countryTotals.youtube += recordCount;

                categoryList.push({
                    name: formatCategoryName(file.replace('.csv', '')),
                    records: recordCount,
                    hasEmail: !!hasFields.email,
                    hasPhone: !!hasFields.phone,
                    hasWebsite: !!hasFields.website,
                    fileSize: formatFileSize(stat.size)
                });
            }

            // Add to global totals
            globalTotals.totalRecords += countryTotals.records;
            globalTotals.totalEmails += countryTotals.emails;
            globalTotals.totalPhones += countryTotals.phones;
            globalTotals.totalWebsites += countryTotals.websites;
            globalTotals.totalLinkedin += countryTotals.linkedin;
            globalTotals.totalFacebook += countryTotals.facebook;
            globalTotals.totalInstagram += countryTotals.instagram;
            globalTotals.totalTwitter += countryTotals.twitter;
            globalTotals.totalTiktok += countryTotals.tiktok;
            globalTotals.totalYoutube += countryTotals.youtube;
            globalTotals.totalCategories += csvFiles.length;

            countryStats.push({
                code: countryCode,
                name: getCountryName(countryCode),
                totalRecords: countryTotals.records,
                totalEmails: countryTotals.emails,
                totalPhones: countryTotals.phones,
                totalWebsites: countryTotals.websites,
                totalLinkedin: countryTotals.linkedin,
                totalFacebook: countryTotals.facebook,
                totalInstagram: countryTotals.instagram,
                totalTwitter: countryTotals.twitter,
                totalTiktok: countryTotals.tiktok,
                totalYoutube: countryTotals.youtube,
                totalCategories: csvFiles.length,
                totalSize: formatFileSize(countryTotals.totalSize),
                topCategories: categoryList.sort((a, b) => b.records - a.records)
            });
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Stats] Done in ${elapsed}s — ${globalTotals.totalRecords.toLocaleString()} total records`);

        const result = {
            success: true,
            message: 'Stats fetched',
            data: {
                summary: {
                    totalCountries: mergedFolders.length,
                    ...globalTotals
                },
                countries: countryStats,
                lastComputed: new Date().toISOString(),
                computeTimeSeconds: parseFloat(elapsed)
            }
        };

        // Cache the result
        statsCache = result;
        statsCacheTime = Date.now();
        console.log('[Stats] Stats cached successfully');

        res.json(result);
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
