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
const MERGED_DATA_BASE = process.env.MERGED_DATA_PATH || __dirname; // Same directory as this server.js
const SAMPLE_DATA_BASE = (() => {
    if (process.env.SAMPLE_DATA_PATH) return process.env.SAMPLE_DATA_PATH;
    const candidates = [
        path.join(__dirname, '..', 'sample_data'),
        path.join(__dirname, 'sample_data'),
        path.join(__dirname, '..', 'sample_processed_data')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    }
    return path.join(__dirname, '..', 'sample_data');
})();

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({ origin: '*', methods: ['GET'] }));
app.use(express.json());

// ==========================================
// HELPERS
// ==========================================

function getMergedDir(countryCode) {
    if (!countryCode) return '';
    const lower = countryCode.toLowerCase();
    if (lower === 'germany' || lower === 'de') return path.join(MERGED_DATA_BASE, 'Germany_Merged');
    if (lower === 'france' || lower === 'fr') return path.join(MERGED_DATA_BASE, 'France_Merged');
    if (lower === 'uk' || lower === 'gb') return path.join(MERGED_DATA_BASE, 'UK_Merged');
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

function getCountryCodeFromName(name) {
    const countries = {
        'United States': 'US', 'United Kingdom': 'UK', 'Canada': 'CA',
        'Australia': 'AU', 'India': 'IN', 'Germany': 'DE',
        'France': 'FR', 'Japan': 'JP', 'Brazil': 'BR', 'Mexico': 'MX', 'Austria': 'AT'
    };
    for (const [code, n] of Object.entries(countries)) {
        if (n.toLowerCase() === name.toLowerCase()) return code;
    }
    return name.toUpperCase(); // Ensure unique code instead of 2 letters
}

function getCountryName(code) {
    const countries = {
        'US': 'United States', 'UK': 'United Kingdom', 'CA': 'Canada',
        'AU': 'Australia', 'IN': 'India', 'DE': 'Germany',
        'FR': 'France', 'JP': 'Japan', 'BR': 'Brazil', 'MX': 'Mexico',
        'AT': 'Austria', 'GERMANY': 'Germany', 'FRANCE': 'France'
    };
    if (countries[code.toUpperCase()]) return countries[code.toUpperCase()];
    
    try {
        if (fs.existsSync(SAMPLE_DATA_BASE)) {
            const items = fs.readdirSync(SAMPLE_DATA_BASE, { withFileTypes: true });
            const match = items.find(item => item.isDirectory() && item.name.toUpperCase() === code.toUpperCase());
            if (match) return match.name;
        }
    } catch(e) {}

    return (code.length > 2 ? code.charAt(0).toUpperCase() + code.slice(1).toLowerCase() : code.toUpperCase());
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
// Read CSV with pagination, optional search, and state/city filtering
// Supports both dedicated state/city columns AND Address-based matching
function readCsvFilteredPaginated(filePath, page = 1, limit = 20, search = '', state = '', city = '') {
    return new Promise((resolve, reject) => {
        const allMatching = [];
        const lowerSearch = search.toLowerCase();
        const lowerState = state.toLowerCase().trim();
        const lowerCity = city.toLowerCase().trim();
        let stateCol = null;
        let cityCol = null; 
        let addressCol = null;
        let columns = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('headers', (headers) => {
                columns = headers;
                const lowerHeaders = headers.map(h => h.toLowerCase().trim());
                stateCol = headers.find((h, i) => /^(state|province|region)$/i.test(lowerHeaders[i]));
                cityCol = headers.find((h, i) => /^(city|town|municipality)$/i.test(lowerHeaders[i]));
                addressCol = headers.find((h, i) => /^(address|full_address|location)$/i.test(lowerHeaders[i]));
            })
            .on('data', (row) => {
                // Filter by state
                if (lowerState) {
                    if (stateCol) {
                        const rowState = (row[stateCol] || '').toLowerCase().trim();
                        if (rowState !== lowerState) return;
                    } else if (addressCol) {
                        const addr = (row[addressCol] || '').toLowerCase();
                        if (!addr.includes(lowerState)) return;
                    } else {
                        // No state or address column — search all values
                        const allVals = Object.values(row).join(' ').toLowerCase();
                        if (!allVals.includes(lowerState)) return;
                    }
                }
                // Filter by city
                if (lowerCity) {
                    if (cityCol) {
                        const rowCity = (row[cityCol] || '').toLowerCase().trim();
                        if (rowCity !== lowerCity) return;
                    } else if (addressCol) {
                        const addr = (row[addressCol] || '').toLowerCase();
                        if (!addr.includes(lowerCity)) return;
                    } else {
                        const allVals = Object.values(row).join(' ').toLowerCase();
                        if (!allVals.includes(lowerCity)) return;
                    }
                }
                // Filter by search if provided
                if (search) {
                    const matches = Object.values(row).some(val =>
                        (val || '').toString().toLowerCase().includes(lowerSearch)
                    );
                    if (!matches) return;
                }
                allMatching.push(row);
            })
            .on('end', () => {
                const total = allMatching.length;
                const totalPages = Math.ceil(total / limit);
                const skip = (page - 1) * limit;
                const paginatedData = allMatching.slice(skip, skip + limit);
                resolve({ columns, data: paginatedData, pagination: { total, page, limit, totalPages } });
            })
            .on('error', (err) => reject(err));
    });
}

// FAST: Count rows matching state/city using raw text line scanning (no CSV parsing)
function countFilteredRowsFast(filePath, lowerState, lowerCity) {
    return new Promise((resolve) => {
        let total = 0;
        let isFirstLine = true;
        let hasEmail = false;
        let hasPhone = false;
        let hasWebsite = false;
        let remainder = '';

        const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
        
        stream.on('data', (chunk) => {
            const text = remainder + chunk;
            const lines = text.split('\n');
            remainder = lines.pop();
            
            for (const line of lines) {
                if (isFirstLine) {
                    const h = line.toLowerCase();
                    hasEmail = h.includes('email');
                    hasPhone = h.includes('phone');
                    hasWebsite = h.includes('website') || h.includes('url');
                    isFirstLine = false;
                    continue;
                }
                if (!line.trim()) continue;
                const lower = line.toLowerCase();
                if (lowerState && !lower.includes(lowerState)) continue;
                if (lowerCity && !lower.includes(lowerCity)) continue;
                total++;
            }
        });
        
        stream.on('end', () => {
            if (remainder.trim() && !isFirstLine) {
                const lower = remainder.toLowerCase();
                if ((!lowerState || lower.includes(lowerState)) && 
                    (!lowerCity || lower.includes(lowerCity))) {
                    total++;
                }
            }
            resolve({ total, hasEmail, hasPhone, hasWebsite });
        });
        
        stream.on('error', () => resolve({ total: 0, hasEmail: false, hasPhone: false, hasWebsite: false }));
    });
}

// ==========================================
// PRICING HELPER
// ==========================================
// Load pricing from the central _pricing.json file in the MERGED_DATA_BASE
const PRICING_CACHE_FILE = path.join(MERGED_DATA_BASE, '_pricing.json');

function loadPricing() {
    try {
        if (fs.existsSync(PRICING_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(PRICING_CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading pricing cache:', e);
    }
    return {};
}

function savePricing(data) {
    try {
        fs.writeFileSync(PRICING_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Error saving pricing cache:', e);
        return false;
    }
}

// Generate a unique key for an item's price
function getPriceKey(country, state = '', city = '', category = '') {
    const resolvedCountry = country ? getCountryName(country).toUpperCase() : '';
    return [
        resolvedCountry,
        state?.toLowerCase().trim() || '',
        city?.toLowerCase().trim() || '',
        category?.toLowerCase().trim() || ''
    ].join('_||_'); // Using a clear separator
}

// ==========================================
// API ENDPOINTS
// ==========================================

// GET /api/merged/countries — List available countries
app.get('/api/merged/countries', (req, res) => {
    try {
        const hasMerged = fs.existsSync(MERGED_DATA_BASE);
        const hasSample = fs.existsSync(SAMPLE_DATA_BASE);
        const countriesMap = new Map();

        if (hasMerged) {
            const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
            items.filter(item => item.isDirectory() && item.name.endsWith('_Merged')).forEach(item => {
                const code = item.name.replace('_Merged', '');
                const mergedDir = path.join(MERGED_DATA_BASE, item.name);
                let csvFiles = [];
                try { csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv')); } catch(e){}
                countriesMap.set(code.toUpperCase(), {
                    code: code.toUpperCase(),
                    name: getCountryName(code),
                    totalCategories: csvFiles.length,
                    mergedCategories: new Set(csvFiles.map(f => f.replace('.csv', '')))
                });
            });
        }

        if (hasSample) {
            const items = fs.readdirSync(SAMPLE_DATA_BASE, { withFileTypes: true });
            items.filter(item => item.isDirectory()).forEach(item => {
                const name = item.name;
                const code = getCountryCodeFromName(name);
                const sampleDir = path.join(SAMPLE_DATA_BASE, name);
                let csvFiles = [];
                try { csvFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.csv')); } catch(e){}
                
                if (countriesMap.has(code)) {
                    const existing = countriesMap.get(code);
                    csvFiles.forEach(f => {
                        const cat = f.replace('.csv', '');
                        if (!existing.mergedCategories.has(cat)) existing.totalCategories += 1;
                    });
                } else {
                    countriesMap.set(code, {
                        code: code,
                        name: getCountryName(code) || name,
                        totalCategories: csvFiles.length,
                        mergedCategories: new Set()
                    });
                }
            });
        }

        const countries = Array.from(countriesMap.values()).map(c => ({
            code: c.code,
            name: c.name,
            totalCategories: c.totalCategories
        }));

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
        const countryName = getCountryName(country);
        const sampleDir = path.join(SAMPLE_DATA_BASE, countryName);

        let csvFilesMerged = [];
        let csvFilesSample = [];
        if (fs.existsSync(mergedDir)) csvFilesMerged = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
        if (fs.existsSync(sampleDir)) csvFilesSample = fs.readdirSync(sampleDir).filter(f => f.endsWith('.csv'));

        if (csvFilesMerged.length === 0 && csvFilesSample.length === 0) {
            return res.status(404).json({ success: false, message: `No data for: ${country}` });
        }
        
        const totalFiles = csvFilesMerged.length + csvFilesSample.length;
        
        // ===== CACHING: compute once, serve instantly =====
        const cacheDir = fs.existsSync(mergedDir) ? mergedDir : sampleDir;
        const cacheFile = path.join(cacheDir, `_categories_cache.json`);
        let categories = null;
        
        // Check if cache exists and is still valid (same number of CSV files combined)
        if (fs.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                if (cached.fileCount === totalFiles) {
                    const pricing = loadPricing();
                    categories = cached.categories.map(cat => {
                        const pKey = getPriceKey(country, '', '', cat.name);
                        const priceData = pricing[pKey] || {};
                        return {
                            ...cat,
                            price: priceData.price || cat.price,
                            previousPrice: priceData.previousPrice || cat.previousPrice
                        };
                    });
                    console.log(`[Cache HIT] ${country} — ${categories.length} categories`);
                }
            } catch (e) { /* cache corrupt, rebuild */ }
        }
        
        // Cache miss — compute and save
        if (!categories) {
            console.log(`[Cache MISS] ${country} — computing ${totalFiles} categories...`);
            const startTime = Date.now();
            const categoriesMap = new Map();

            // Process Sample First
            for (const file of csvFilesSample) {
                const categoryName = file.replace('.csv', '');
                const filePath = path.join(sampleDir, file);
                const stat = fs.statSync(filePath);

                const [recordCount, hasFields] = await Promise.all([
                    quickLineCount(filePath),
                    readCsvHeaders(filePath)
                ]);

                // Inflate fake records for realism
                let hash = 0;
                for (let i = 0; i < categoryName.length; i++) { hash = ((hash << 5) - hash) + categoryName.charCodeAt(i); hash |= 0; }
                const fakeRecords = 12500 + (Math.abs(hash) % 25000);

                const pricing = loadPricing();
                const pKey = getPriceKey(country, '', '', categoryName);
                const priceData = pricing[pKey] || {};

                categoriesMap.set(categoryName, {
                    name: categoryName,
                    displayName: formatCategoryName(categoryName),
                    fileName: file,
                    records: fakeRecords, // Inflated!
                    hasEmail: !!hasFields.email,
                    hasPhone: !!hasFields.phone,
                    hasWebsite: !!hasFields.website,
                    hasLinkedin: !!hasFields.linkedin,
                    hasFacebook: !!hasFields.facebook,
                    hasInstagram: !!hasFields.instagram,
                    hasTwitter: !!hasFields.twitter,
                    hasTiktok: !!hasFields.tiktok,
                    hasYoutube: !!hasFields.youtube,
                    fileSize: stat.size * 100, // Inflated size
                    fileSizeFormatted: formatFileSize(stat.size * 100), // Inflated size formatted
                    lastModified: stat.mtime,
                    price: priceData.price || null,
                    previousPrice: priceData.previousPrice || null,
                    isSample: true
                });
            }

            // Real Merged Takes Precedence
            for (const file of csvFilesMerged) {
                const categoryName = file.replace('.csv', '');
                const filePath = path.join(mergedDir, file);
                const stat = fs.statSync(filePath);

                const [recordCount, hasFields] = await Promise.all([
                    quickLineCount(filePath),
                    readCsvHeaders(filePath)
                ]);

                const pricing = loadPricing();
                const pKey = getPriceKey(country, '', '', categoryName);
                const priceData = pricing[pKey] || {};

                categoriesMap.set(categoryName, {
                    name: categoryName,
                    displayName: formatCategoryName(categoryName),
                    fileName: file,
                    records: recordCount, // Real record count
                    hasEmail: !!hasFields.email,
                    hasPhone: !!hasFields.phone,
                    hasWebsite: !!hasFields.website,
                    hasLinkedin: !!hasFields.linkedin,
                    hasFacebook: !!hasFields.facebook,
                    hasInstagram: !!hasFields.instagram,
                    hasTwitter: !!hasFields.twitter,
                    hasTiktok: !!hasFields.tiktok,
                    hasYoutube: !!hasFields.youtube,
                    fileSize: stat.size,
                    fileSizeFormatted: formatFileSize(stat.size),
                    lastModified: stat.mtime,
                    price: priceData.price || null,
                    previousPrice: priceData.previousPrice || null,
                    isSample: false
                });
            }

            categories = Array.from(categoriesMap.values());
            categories.sort((a, b) => a.displayName.localeCompare(b.displayName));
            
            // Save cache
            try {
                fs.writeFileSync(cacheFile, JSON.stringify({ fileCount: totalFiles, categories }, null, 0));
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
                country: getCountryName(country) === 'United States' ? country.toUpperCase() : getCountryName(country),
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

// GET /api/merged/data?country=US&category=schools&page=1&limit=20&search=xyz&state=California&city=Los+Angeles
app.get('/api/merged/data', async (req, res) => {
    try {
        const { country, category, page = 1, limit = 20, search = '', state = '', city = '' } = req.query;
        if (!country || !category) return res.status(400).json({ success: false, message: 'Country and category required' });

        const mergedDir = getMergedDir(country);
        const countryName = getCountryName(country);
        const sampleDir = path.join(SAMPLE_DATA_BASE, countryName);
        
        let filePath = path.join(mergedDir, `${category}.csv`);
        let isSample = false;

        if (!fs.existsSync(filePath)) {
            filePath = path.join(sampleDir, `${category}.csv`);
            isSample = true;
        }

        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: `Data not found: ${category} in ${country}` });

        const result = await readCsvFilteredPaginated(filePath, parseInt(page), parseInt(limit), search, state, city);

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;

        // If it's sample data, logically inflate pagination numbers so it seems vast
        if (isSample && result.pagination.total < 1000) {
            let hash = 0;
            for (let i = 0; i < category.length; i++) { hash = ((hash << 5) - hash) + category.charCodeAt(i); hash |= 0; }
            const fakeTotal = 12500 + (Math.abs(hash) % 25000);
            result.pagination.total = fakeTotal;
            result.pagination.totalPages = Math.ceil(fakeTotal / limitNum);
        }

        res.json({
            success: true,
            message: 'Data fetched',
            data: { 
                country: getCountryName(country) === 'United States' ? country.toUpperCase() : getCountryName(country), 
                category: formatCategoryName(category), 
                isSample,
                ...result 
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/merged/preview?country=US&category=AA_Shops
// FAST: Returns first 50 rows and actual headers for previewing
app.get('/api/merged/preview', async (req, res) => {
    try {
        const { country, category } = req.query;
        if (!country || !category) {
            return res.status(400).json({ success: false, message: 'Country and category parameters required' });
        }

        const mergedDir = getMergedDir(country);
        const countryName = getCountryName(country);
        const sampleDir = path.join(SAMPLE_DATA_BASE, countryName);
        
        let filePath = path.join(mergedDir, `${category}.csv`);
        let isSample = false;

        if (!fs.existsSync(filePath)) {
            filePath = path.join(sampleDir, `${category}.csv`);
            isSample = true;
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: `Data not found: ${category} in ${country}` });
        }

        const rows = [];
        let columns = [];
        let rowCount = 0;
        const PREVIEW_LIMIT = 50;

        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('headers', (headers) => {
                    columns = headers;
                })
                .on('data', (row) => {
                    if (rowCount < PREVIEW_LIMIT) {
                        rows.push(row);
                        rowCount++;
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        res.json({
            success: true,
            message: 'Preview data fetched',
            data: {
                country: getCountryName(country) === 'United States' ? country.toUpperCase() : getCountryName(country),
                category: formatCategoryName(category),
                isSample,
                columns,
                rows
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Cache for filtered counts
const filteredCountCache = {};
const FILTERED_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// GET /api/merged/categories-count?country=US&state=California&city=Los+Angeles&page=1&limit=20
// FAST: parallel file scanning + caching + pagination
app.get('/api/merged/categories-count', async (req, res) => {
    try {
        const { country, state = '', city = '', category = '', page = 1, limit = 20 } = req.query;
        if (!country) return res.status(400).json({ success: false, message: 'Country parameter is required' });

        const mergedDir = getMergedDir(country);
        const countryName = getCountryName(country);
        const sampleDir = path.join(SAMPLE_DATA_BASE, countryName);
        let targetDir = mergedDir;

        if (!fs.existsSync(mergedDir)) {
            if (fs.existsSync(sampleDir)) {
                targetDir = sampleDir;
            } else {
                return res.status(404).json({ success: false, message: `No data for: ${country}` });
            }
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = parseInt(limit) || 20;

        // 1. In-memory cache (fastest)
        const cacheKey = `${country}_${state}_${city}_${category}_p${pageNum}_l${limitNum}`.toLowerCase();
        if (filteredCountCache[cacheKey] && (Date.now() - filteredCountCache[cacheKey].time) < FILTERED_CACHE_TTL) {
            console.log(`[categories-count] Memory Cache HIT for ${cacheKey}`);
            return res.json(filteredCountCache[cacheKey].data);
        }

        const lowerState = state.toLowerCase().trim();
        const lowerCity = city.toLowerCase().trim();
        const lowerCategory = category.toLowerCase().trim().replace(/\s+/g, '_');

        // 2. Pre-computed disk cache (instant)
        if (lowerState && !lowerCategory) {
            let countryNamePrefix = getCountryName(country).toLowerCase();
            if (countryNamePrefix === 'united states') countryNamePrefix = 'us';
            else if (countryNamePrefix === 'united kingdom') countryNamePrefix = 'uk';
            
            let cacheFileName = `${countryNamePrefix}_state_${lowerState.replace(/\s+/g, '_')}`;
            if (lowerCity) {
                cacheFileName += `_city_${lowerCity.replace(/\s+/g, '_')}`;
            }
            cacheFileName += '.json';
            
            const cacheFilePath = path.join(targetDir, '.cache', cacheFileName);
            if (fs.existsSync(cacheFilePath)) {
                console.log(`[categories-count] Disk Cache HIT for ${cacheFilePath}`);
                const diskCacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
                
                // Handle Pagination on Disk Cache
                const totalCategories = diskCacheData.categories.length;
                const totalPages = Math.ceil(totalCategories / limitNum);
                const skip = (pageNum - 1) * limitNum;
                const paginatedCategories = diskCacheData.categories.slice(skip, skip + limitNum);

                const responseData = {
                    ...diskCacheData,
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
                };

                // Save to memory cache for next time
                filteredCountCache[cacheKey] = { time: Date.now(), data: responseData };
                return res.json(responseData);
            }
        }

        let csvFiles = fs.readdirSync(targetDir).filter(f => f.endsWith('.csv'));

        // FAST PATH: If a specific category is requested, only scan that file
        if (lowerCategory) {
            const matchedFiles = csvFiles.filter(f => f.replace('.csv', '').toLowerCase() === lowerCategory);
            if (matchedFiles.length > 0) {
                csvFiles = matchedFiles;
            } else if (category) {
                 const displayMatched = csvFiles.filter(f => formatCategoryName(f.replace('.csv', '')).toLowerCase() === category.toLowerCase());
                 if (displayMatched.length > 0) {
                     csvFiles = displayMatched;
                 } else {
                     csvFiles = []; // No match found
                 }
            } else {
                csvFiles = [];
            }
        }

        // Apply pagination BEFORE scanning to save massive computation
        const totalFilesToScan = csvFiles.length;
        const totalPages = Math.ceil(totalFilesToScan / limitNum);
        const skip = (pageNum - 1) * limitNum;
        const pagedCsvFiles = csvFiles.slice(skip, skip + limitNum);

        console.log(`[categories-count] country=${country} state="${state}" category="${category}" page=${pageNum} — scanning ${pagedCsvFiles.length}/${totalFilesToScan} files (FAST)...`);
        const startTime = Date.now();

        // Process files in PARALLEL batches of 50
        const BATCH_SIZE = 50;
        const categories = [];

        for (let i = 0; i < pagedCsvFiles.length; i += BATCH_SIZE) {
            const batch = pagedCsvFiles.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(async (file) => {
                const categoryName = file.replace('.csv', '');
                const filePath = path.join(targetDir, file);
                const countResult = await countFilteredRowsFast(filePath, lowerState, lowerCity);
                return {
                    name: categoryName,
                    displayName: formatCategoryName(categoryName),
                    records: countResult.total,
                    hasEmail: countResult.hasEmail,
                    hasPhone: countResult.hasPhone,
                    hasWebsite: countResult.hasWebsite
                };
            }));
            categories.push(...results);
        }

        // Only sorting the current page, which is acceptable since the UI lists them arbitrarily or we can sort later from cache.
        // For accurate A-Z sorting of all items without disk cache, it requires a full scan. 
        // We'll sort the paginated results for now, but ideally pre-compute disk cache.
        categories.sort((a, b) => a.displayName.localeCompare(b.displayName));

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[categories-count] Paged scan done in ${elapsed}s`);

        const responseData = {
            success: true,
            message: 'Filtered category counts fetched',
            data: {
                country: getCountryName(country) === 'United States' ? country.toUpperCase() : getCountryName(country),
                state: state,
                city: city,
                category: category || undefined,
                totalCategories: totalFilesToScan,
                categories,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    totalPages,
                    totalCategories: totalFilesToScan,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1
                }
            }
        };

        // Save to cache
        filteredCountCache[cacheKey] = { time: Date.now(), data: responseData };

        res.json(responseData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/merged/browse
// Used by the Frontend admin panel to browse folders and datasets
app.get('/api/merged/browse', async (req, res) => {
    try {
        const { country = '', state = '', city = '', search = '', page = 1, limit = 50 } = req.query;
        
        let breadcrumb = [];
        let folders = [];
        let categoriesList = [];
        let summary = { totalRecords: 0, totalEmails: 0, totalPhones: 0, totalWebsites: 0 };

        const pricing = loadPricing();

        if (!country) {
            // Root level: Return list of countries
            const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
            folders = items
                .filter(item => item.isDirectory() && item.name.endsWith('_Merged'))
                .map(item => {
                    const code = item.name.replace('_Merged', '');
                    return { code, name: getCountryName(code) };
                });
        } else {
            const mergedDir = getMergedDir(country);
            if (!fs.existsSync(mergedDir)) return res.status(404).json({ success: false, message: `No data for: ${country}` });

            breadcrumb.push({ label: getCountryName(country), level: 'country' });
            if (state) breadcrumb.push({ label: state, level: 'state' });
            if (city) breadcrumb.push({ label: city, level: 'city' });

            const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
            const lowerState = state.toLowerCase().trim();
            const lowerCity = city.toLowerCase().trim();

            if (!state && !city) {
                // Return country-level categories
                // First try to look for disk cache
                const cacheFile = path.join(mergedDir, `_categories_cache.json`);
                if (fs.existsSync(cacheFile)) {
                    try {
                        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                        categoriesList = cached.categories.map(cat => {
                            const pKey = getPriceKey(country, '', '', cat.name);
                            return { ...cat, price: pricing[pKey]?.price || null, previousPrice: pricing[pKey]?.previousPrice || null };
                        });
                        summary.totalRecords = categoriesList.reduce((acc, c) => acc + (c.records || 0), 0);
                        summary.totalEmails = categoriesList.reduce((acc, c) => acc + (c.hasEmail ? c.records : 0), 0);
                        summary.totalPhones = categoriesList.reduce((acc, c) => acc + (c.hasPhone ? c.records : 0), 0);
                        summary.totalWebsites = categoriesList.reduce((acc, c) => acc + (c.hasWebsite ? c.records : 0), 0);
                    } catch (e) {}
                }
            } else {
                // Handle state/city browse. Uses cached data if available for fast response.
                let countryNamePrefix = getCountryName(country).toLowerCase();
                if (countryNamePrefix === 'united states') countryNamePrefix = 'us';
                else if (countryNamePrefix === 'united kingdom') countryNamePrefix = 'uk';
                
                const cacheFileName = lowerState && lowerCity 
                    ? `${countryNamePrefix}_state_${lowerState.replace(/\s+/g, '_')}_city_${lowerCity.replace(/\s+/g, '_')}.json`
                    : `${countryNamePrefix}_state_${lowerState.replace(/\s+/g, '_')}.json`;
                
                const cacheFilePath = path.join(mergedDir, '.cache', cacheFileName);
                if (fs.existsSync(cacheFilePath)) {
                    const diskCacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
                    categoriesList = diskCacheData.categories.map(cat => {
                        const pKey = getPriceKey(country, state, city, cat.name);
                        return { ...cat, price: pricing[pKey]?.price || null, previousPrice: pricing[pKey]?.previousPrice || null };
                    });
                    summary = {
                        totalRecords: categoriesList.reduce((acc, c) => acc + (c.records || 0), 0),
                        totalEmails: categoriesList.reduce((acc, c) => acc + (c.hasEmail ? c.records : 0), 0),
                        totalPhones: categoriesList.reduce((acc, c) => acc + (c.hasPhone ? c.records : 0), 0),
                        totalWebsites: categoriesList.reduce((acc, c) => acc + (c.hasWebsite ? c.records : 0), 0),
                    };
                }
            }
        }

        if (search) {
            const searchLower = search.toLowerCase();
            categoriesList = categoriesList.filter(c => c.name.toLowerCase().includes(searchLower));
        }

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        const totalCategories = categoriesList.length;
        const totalPages = Math.ceil(totalCategories / limitNum);
        const skip = (pageNum - 1) * limitNum;
        
        const paginatedCategories = categoriesList.slice(skip, skip + limitNum);

        res.json({
            success: true,
            message: 'Browse data fetched',
            data: { 
                breadcrumb, 
                folders, 
                categories: paginatedCategories, 
                summary,
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

// POST /api/merged/update-price
app.post('/api/merged/update-price', async (req, res) => {
    try {
        const { country, state = '', city = '', category, price, previousPrice } = req.body;
        if (!country || !category) {
            return res.status(400).json({ success: false, message: 'Country and category are required' });
        }

        const pricing = loadPricing();
        const pKey = getPriceKey(country, state, city, category);
        
        pricing[pKey] = {
            price: price || null,
            previousPrice: previousPrice || null,
            updatedAt: new Date().toISOString()
        };

        if (savePricing(pricing)) {
            res.json({ success: true, message: 'Price updated successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to write pricing data' });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/merged/bulk-update-price
app.post('/api/merged/bulk-update-price', async (req, res) => {
    try {
        const { country, state = '', city = '', price, previousPrice } = req.body;
        if (!country) {
            return res.status(400).json({ success: false, message: 'Country is required' });
        }

        const mergedDir = getMergedDir(country);
        if (!fs.existsSync(mergedDir)) return res.status(404).json({ success: false, message: `No data for: ${country}` });

        const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
        const pricing = loadPricing();
        let updateCount = 0;

        for (const file of csvFiles) {
            const categoryName = file.replace('.csv', '');
            const pKey = getPriceKey(country, state, city, categoryName);
            
            pricing[pKey] = {
                price: price || null,
                previousPrice: previousPrice || null,
                updatedAt: new Date().toISOString()
            };
            updateCount++;
        }

        if (savePricing(pricing)) {
            res.json({ success: true, message: `Successfully updated ${updateCount} categories` });
        } else {
            res.status(500).json({ success: false, message: 'Failed to write pricing data' });
        }
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
        const forceRefresh = req.query.refresh === 'true';

        if (!forceRefresh && statsCache && (Date.now() - statsCacheTime) < STATS_CACHE_TTL) {
            console.log('[Stats] Returning cached stats');
            return res.json(statsCache);
        }

        console.log('[Stats] Computing stats (fast mode)...');
        const startTime = Date.now();
        
        let globalTotals = {
            totalRecords: 0, totalEmails: 0, totalPhones: 0, totalWebsites: 0,
            totalLinkedin: 0, totalFacebook: 0, totalInstagram: 0,
            totalTwitter: 0, totalTiktok: 0, totalYoutube: 0,
            totalCategories: 0
        };

        const countryStatsMap = new Map();
        
        const hasMerged = fs.existsSync(MERGED_DATA_BASE);
        const hasSample = fs.existsSync(SAMPLE_DATA_BASE);

        if (hasSample) {
            const items = fs.readdirSync(SAMPLE_DATA_BASE, { withFileTypes: true });
            for (const folder of items.filter(item => item.isDirectory())) {
                const countryCode = getCountryCodeFromName(folder.name);
                const sampleDir = path.join(SAMPLE_DATA_BASE, folder.name);
                const csvFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.csv'));
                
                let countryTotals = { records: 0, emails: 0, phones: 0, websites: 0, linkedin: 0, facebook: 0, instagram: 0, twitter: 0, tiktok: 0, youtube: 0, totalSize: 0 };
                const categoryList = new Map();

                for (const file of csvFiles) {
                    const filePath = path.join(sampleDir, file);
                    const stat = fs.statSync(filePath);
                    const categoryName = file.replace('.csv', '');
                    
                    const [lineCount, hasFields] = await Promise.all([quickLineCount(filePath), readCsvHeaders(filePath)]);
                    
                    let hash = 0;
                    for (let i = 0; i < categoryName.length; i++) { hash = ((hash << 5) - hash) + categoryName.charCodeAt(i); hash |= 0; }
                    const inflatedCount = 12500 + (Math.abs(hash) % 25000);

                    countryTotals.records += inflatedCount;
                    countryTotals.totalSize += stat.size * 50;

                    if (hasFields.email) countryTotals.emails += inflatedCount;
                    if (hasFields.phone) countryTotals.phones += inflatedCount;
                    if (hasFields.website) countryTotals.websites += inflatedCount;
                    if (hasFields.linkedin) countryTotals.linkedin += inflatedCount;
                    if (hasFields.facebook) countryTotals.facebook += inflatedCount;
                    if (hasFields.instagram) countryTotals.instagram += inflatedCount;
                    if (hasFields.twitter) countryTotals.twitter += inflatedCount;
                    if (hasFields.tiktok) countryTotals.tiktok += inflatedCount;
                    if (hasFields.youtube) countryTotals.youtube += inflatedCount;

                    categoryList.set(categoryName, { name: formatCategoryName(categoryName), records: inflatedCount, hasEmail: !!hasFields.email, hasPhone: !!hasFields.phone, hasWebsite: !!hasFields.website, fileSize: formatFileSize(stat.size * 50) });
                }

                countryStatsMap.set(countryCode, {
                    code: countryCode, name: getCountryName(countryCode) || folder.name,
                    ...countryTotals, totalCategories: csvFiles.length,
                    categories: categoryList
                });
            }
        }

        if (hasMerged) {
            const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
            const mergedFolders = items.filter(item => item.isDirectory() && item.name.endsWith('_Merged'));

            for (const folder of mergedFolders) {
                const countryCode = folder.name.replace('_Merged', '');
                const mergedDir = path.join(MERGED_DATA_BASE, folder.name);
                const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));

                let countryData = countryStatsMap.get(countryCode) || {
                    code: countryCode, name: getCountryName(countryCode),
                    records: 0, emails: 0, phones: 0, websites: 0, linkedin: 0, facebook: 0, instagram: 0, twitter: 0, tiktok: 0, youtube: 0, totalSize: 0,
                    totalCategories: 0, categories: new Map()
                };

                for (const file of csvFiles) {
                    const filePath = path.join(mergedDir, file);
                    const stat = fs.statSync(filePath);
                    const categoryName = file.replace('.csv', '');
                    
                    const [recordCount, hasFields] = await Promise.all([quickLineCount(filePath), readCsvHeaders(filePath)]);

                    if (countryData.categories.has(categoryName)) {
                        const previous = countryData.categories.get(categoryName);
                        countryData.records -= previous.records;
                    }

                    countryData.records += recordCount;
                    countryData.totalSize += stat.size;

                    if (hasFields.email) countryData.emails += recordCount;
                    if (hasFields.phone) countryData.phones += recordCount;
                    if (hasFields.website) countryData.websites += recordCount;
                    if (hasFields.linkedin) countryData.linkedin += recordCount;
                    if (hasFields.facebook) countryData.facebook += recordCount;
                    if (hasFields.instagram) countryData.instagram += recordCount;
                    if (hasFields.twitter) countryData.twitter += recordCount;
                    if (hasFields.tiktok) countryData.tiktok += recordCount;
                    if (hasFields.youtube) countryData.youtube += recordCount;

                    countryData.categories.set(categoryName, { name: formatCategoryName(categoryName), records: recordCount, hasEmail: !!hasFields.email, hasPhone: !!hasFields.phone, hasWebsite: !!hasFields.website, fileSize: formatFileSize(stat.size) });
                }
                
                countryData.totalCategories = countryData.categories.size;
                countryStatsMap.set(countryCode, countryData);
            }
        }

        const countryStats = [];
        for (const [code, c] of countryStatsMap.entries()) {
            globalTotals.totalRecords += c.records;
            globalTotals.totalEmails += c.emails;
            globalTotals.totalPhones += c.phones;
            globalTotals.totalWebsites += c.websites;
            globalTotals.totalLinkedin += c.linkedin || 0;
            globalTotals.totalFacebook += c.facebook || 0;
            globalTotals.totalInstagram += c.instagram || 0;
            globalTotals.totalTwitter += c.twitter || 0;
            globalTotals.totalTiktok += c.tiktok || 0;
            globalTotals.totalYoutube += c.youtube || 0;
            globalTotals.totalCategories += c.totalCategories;

            countryStats.push({
                code: c.code,
                name: c.name,
                totalRecords: c.records,
                totalEmails: c.emails,
                totalPhones: c.phones,
                totalWebsites: c.websites,
                totalLinkedin: c.linkedin || 0,
                totalFacebook: c.facebook || 0,
                totalInstagram: c.instagram || 0,
                totalTwitter: c.twitter || 0,
                totalTiktok: c.tiktok || 0,
                totalYoutube: c.youtube || 0,
                totalCategories: c.totalCategories,
                totalSize: formatFileSize(c.totalSize),
                topCategories: Array.from(c.categories.values()).sort((a, b) => b.records - a.records).slice(0, 10)
            });
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Stats] Done in ${elapsed}s — ${globalTotals.totalRecords.toLocaleString()} total records`);

        const result = {
            success: true,
            message: 'Stats fetched',
            data: {
                summary: {
                    totalCountries: countryStatsMap.size,
                    ...globalTotals
                },
                countries: countryStats,
                lastComputed: new Date().toISOString(),
                computeTimeSeconds: parseFloat(elapsed)
            }
        };

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
