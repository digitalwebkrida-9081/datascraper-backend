const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Base path where merged data lives on the VPS
const MERGED_DATA_BASE = process.env.MERGED_DATA_PATH || '/home/scrappingscript/scrappingscript/scraped_data';
const SAMPLE_DATA_BASE = process.env.SAMPLE_DATA_PATH || '/home/scrappingscript/scrappingscript/sample_data';

/**
 * Helper: Get the merged folder name for a country code
 * e.g. "US" -> "US_Merged"
 */
function getMergedDir(countryCode) {
    return path.join(MERGED_DATA_BASE, `${countryCode.toUpperCase()}_Merged`);
}

/**
 * Helper: Get country code from name
 */
function getCountryCodeFromName(name) {
    const countries = {
        'United States': 'US',
        'United Kingdom': 'UK',
        'Canada': 'CA',
        'Australia': 'AU',
        'India': 'IN',
        'Germany': 'DE',
        'France': 'FR',
        'Japan': 'JP',
        'Brazil': 'BR',
        'Mexico': 'MX',
        'Austria': 'AT'
    };
    for (const [code, n] of Object.entries(countries)) {
        if (n.toLowerCase() === name.toLowerCase()) return code;
    }
    return name.toUpperCase(); // Ensure unique code instead of 2 letters
}


/**
 * Helper: Read a CSV file and return all rows as an array of objects
 * Uses streaming to be memory efficient
 */
function readCsvFile(filePath, maxRows = Infinity) {
    return new Promise((resolve, reject) => {
        const results = [];
        let count = 0;
        const stream = fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                if (count < maxRows) {
                    results.push(data);
                    count++;
                } else {
                    stream.destroy(); // Stop reading once we have enough
                }
            })
            .on('end', () => resolve(results))
            .on('close', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

/**
 * Helper: Count rows in a CSV file efficiently without loading all data
 */
function countCsvRows(filePath) {
    return new Promise((resolve, reject) => {
        let count = 0;
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', () => { count++; })
            .on('end', () => resolve(count))
            .on('error', (err) => reject(err));
    });
}

/**
 * Helper: Read CSV with pagination and optional search
 */
function readCsvPaginated(filePath, page = 1, limit = 20, search = '') {
    return new Promise((resolve, reject) => {
        const allMatching = [];
        const lowerSearch = search.toLowerCase();

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // If search is provided, filter rows where any field contains the search term
                if (search) {
                    const values = Object.values(row);
                    const matches = values.some(val =>
                        (val || '').toString().toLowerCase().includes(lowerSearch)
                    );
                    if (matches) {
                        allMatching.push(row);
                    }
                } else {
                    allMatching.push(row);
                }
            })
            .on('end', () => {
                const total = allMatching.length;
                const totalPages = Math.ceil(total / limit);
                const skip = (page - 1) * limit;
                const paginatedData = allMatching.slice(skip, skip + limit);

                resolve({
                    data: paginatedData,
                    pagination: {
                        total,
                        page,
                        limit,
                        totalPages
                    }
                });
            })
            .on('error', (err) => reject(err));
    });
}

/**
 * Helper: Format category name for display
 * e.g. "Truck_dealers" -> "Truck Dealers"
 */
function formatCategoryName(name) {
    return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ==========================================
// API ENDPOINTS
// ==========================================

/**
 * GET /api/merged/countries
 * Lists all available countries that have merged data or sample data
 */
exports.getCountries = async (req, res) => {
    try {
        const hasMerged = fs.existsSync(MERGED_DATA_BASE);
        const hasSample = fs.existsSync(SAMPLE_DATA_BASE);
        
        if (!hasMerged && !hasSample) {
            return errorResponse(res, 'Merged data directories not found', 404);
        }

        const countriesMap = new Map();

        if (hasMerged) {
            const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
            items.filter(item => item.isDirectory() && item.name.endsWith('_Merged')).forEach(item => {
                const code = item.name.replace('_Merged', '');
                const mergedDir = path.join(MERGED_DATA_BASE, item.name);
                const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
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
                try {
                    csvFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.csv'));
                } catch(e) {}
                
                if (countriesMap.has(code)) {
                    const existing = countriesMap.get(code);
                    csvFiles.forEach(f => {
                        const cat = f.replace('.csv', '');
                        if (!existing.mergedCategories.has(cat)) {
                            existing.totalCategories += 1;
                        }
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

        return successResponse(res, { countries }, 'Countries fetched successfully');
    } catch (error) {
        console.error('Error fetching countries:', error);
        return errorResponse(res, 'Failed to fetch countries', 500, error.message);
    }
};

/**
 * GET /api/merged/categories?country=US
 * Lists all available categories (CSV files) for a given country
 */
exports.getCategories = async (req, res) => {
    try {
        const { country } = req.query;

        if (!country) {
            return errorResponse(res, 'Country parameter is required', 400);
        }

        const mergedDir = getMergedDir(country);
        const countryName = getCountryName(country);
        const sampleDir = path.join(SAMPLE_DATA_BASE, countryName);
        
        let csvFilesMerged = [];
        let csvFilesSample = [];

        if (fs.existsSync(mergedDir)) {
            csvFilesMerged = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
        }
        if (fs.existsSync(sampleDir)) {
            csvFilesSample = fs.readdirSync(sampleDir).filter(f => f.endsWith('.csv'));
        }

        if (csvFilesMerged.length === 0 && csvFilesSample.length === 0) {
            return errorResponse(res, `No merged data found for country: ${country}`, 404);
        }

        const categoriesMap = new Map();

        // Process Sample first so we can build a base dictionary
        for (const file of csvFilesSample) {
            const categoryName = file.replace('.csv', '');
            const filePath = path.join(sampleDir, file);
            const stat = fs.statSync(filePath);
            
            // Inflate records to look like a full database reliably per-category
            let hash = 0;
            for (let i = 0; i < categoryName.length; i++) {
                hash = ((hash << 5) - hash) + categoryName.charCodeAt(i);
                hash |= 0;
            }
            const fakeRecords = 12500 + (Math.abs(hash) % 25000);

            categoriesMap.set(categoryName, {
                name: categoryName,
                displayName: formatCategoryName(categoryName),
                fileName: file,
                fileSize: stat.size * 100, // inflated size for realism
                fileSizeFormatted: formatFileSize(stat.size * 100),
                lastModified: stat.mtime,
                isSample: true,
                records: fakeRecords
            });
        }

        // Override with Real Merged if exists (the real merged one should take precedence)
        for (const file of csvFilesMerged) {
            const categoryName = file.replace('.csv', '');
            const filePath = path.join(mergedDir, file);
            const stat = fs.statSync(filePath);

            categoriesMap.set(categoryName, {
                name: categoryName,
                displayName: formatCategoryName(categoryName),
                fileName: file,
                fileSize: stat.size,
                fileSizeFormatted: formatFileSize(stat.size),
                lastModified: stat.mtime,
                isSample: false
            });
        }

        const categories = Array.from(categoriesMap.values());
        categories.sort((a, b) => a.displayName.localeCompare(b.displayName));

        return successResponse(res, {
            country: country.toUpperCase(),
            totalCategories: categories.length,
            categories
        }, 'Categories fetched successfully');
    } catch (error) {
        console.error('Error fetching categories:', error);
        return errorResponse(res, 'Failed to fetch categories', 500, error.message);
    }
};

/**
 * GET /api/merged/data?country=US&category=schools&page=1&limit=20&search=xyz
 * Returns paginated data from a specific merged CSV file or sample data
 */
exports.getMergedData = async (req, res) => {
    try {
        const { country, category, page = 1, limit = 20, search = '' } = req.query;

        if (!country || !category) {
            return errorResponse(res, 'Country and category parameters are required', 400);
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
            return errorResponse(res, `Data not found for ${category} in ${country}`, 404);
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const result = await readCsvPaginated(filePath, pageNum, limitNum, search);
        
        // If it's sample data, logically inflate pagination numbers so it seems vast
        if (isSample && result.pagination.total < 1000) {
            let hash = 0;
            for (let i = 0; i < category.length; i++) {
                hash = ((hash << 5) - hash) + category.charCodeAt(i);
                hash |= 0;
            }
            const fakeTotal = 12500 + (Math.abs(hash) % 25000);
            result.pagination.total = fakeTotal;
            result.pagination.totalPages = Math.ceil(fakeTotal / limitNum);
        }

        return successResponse(res, {
            country: country.toUpperCase(),
            category: formatCategoryName(category),
            isSample,
            ...result
        }, 'Data fetched successfully');
    } catch (error) {
        console.error('Error fetching merged data:', error);
        return errorResponse(res, 'Failed to fetch data', 500, error.message);
    }
};

/**
 * GET /api/merged/stats
 * Returns summary statistics across all countries
 */
exports.getMergedStats = async (req, res) => {
    try {
        const hasMerged = fs.existsSync(MERGED_DATA_BASE);
        const hasSample = fs.existsSync(SAMPLE_DATA_BASE);
        
        if (!hasMerged && !hasSample) {
            return errorResponse(res, 'Merged data directory not found', 404);
        }

        let totalRecords = 0;
        let totalCategories = 0;
        let countriesMap = new Map();

        // Process Sample Data
        if (hasSample) {
            const items = fs.readdirSync(SAMPLE_DATA_BASE, { withFileTypes: true });
            const sampleFolders = items.filter(item => item.isDirectory());
            for (const folder of sampleFolders) {
                const countryCode = getCountryCodeFromName(folder.name);
                const sampleDir = path.join(SAMPLE_DATA_BASE, folder.name);
                const csvFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.csv'));
                
                let countryRecords = 0;
                let countryTotalSize = 0;
                const categoryList = new Map();

                for (const file of csvFiles) {
                    const filePath = path.join(sampleDir, file);
                    const stat = fs.statSync(filePath);
                    const categoryName = file.replace('.csv', '');
                    
                    const lineCount = await quickLineCount(filePath);
                    const inflatedCount = lineCount * 150; // inflate sample logs

                    countryRecords += inflatedCount;
                    countryTotalSize += stat.size * 50;

                    categoryList.set(categoryName, {
                        name: formatCategoryName(categoryName),
                        records: inflatedCount,
                        fileSize: formatFileSize(stat.size * 50)
                    });
                }

                totalRecords += countryRecords;
                totalCategories += csvFiles.length;

                countriesMap.set(countryCode, {
                    code: countryCode,
                    name: getCountryName(countryCode) || folder.name,
                    totalRecords: countryRecords,
                    totalCategories: csvFiles.length,
                    totalSizeBytes: countryTotalSize,
                    categories: categoryList
                });
            }
        }

        // Process Merged Data
        if (hasMerged) {
            const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
            const mergedFolders = items.filter(item => item.isDirectory() && item.name.endsWith('_Merged'));

            for (const folder of mergedFolders) {
                const countryCode = folder.name.replace('_Merged', '');
                const mergedDir = path.join(MERGED_DATA_BASE, folder.name);
                const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));

                let countryData = countriesMap.get(countryCode) || {
                    code: countryCode,
                    name: getCountryName(countryCode),
                    totalRecords: 0,
                    totalCategories: 0,
                    totalSizeBytes: 0,
                    categories: new Map()
                };

                let countryRecords = 0;
                let countryTotalSize = 0;

                for (const file of csvFiles) {
                    const filePath = path.join(mergedDir, file);
                    const stat = fs.statSync(filePath);
                    const categoryName = file.replace('.csv', '');
                    
                    const lineCount = await quickLineCount(filePath);

                    // If we override sample, reduce total records by sample's original
                    if (countryData.categories.has(categoryName)) {
                        const previous = countryData.categories.get(categoryName);
                        totalRecords -= previous.records;
                        countryData.totalRecords -= previous.records;
                        countryData.totalCategories -= 1;
                        totalCategories -= 1;
                    }

                    countryRecords += lineCount;
                    countryTotalSize += stat.size;

                    countryData.categories.set(categoryName, {
                        name: formatCategoryName(categoryName),
                        records: lineCount,
                        fileSize: formatFileSize(stat.size)
                    });
                }

                totalRecords += countryRecords;
                totalCategories += csvFiles.length;
                
                countryData.totalRecords += countryRecords;
                countryData.totalCategories += csvFiles.length;
                countryData.totalSizeBytes += countryTotalSize;
                
                countriesMap.set(countryCode, countryData);
            }
        }

        // Format Result
        const countryStats = Array.from(countriesMap.values()).map(c => {
            return {
                code: c.code,
                name: c.name,
                totalRecords: c.totalRecords,
                totalCategories: c.totalCategories,
                totalSize: formatFileSize(c.totalSizeBytes),
                categories: Array.from(c.categories.values()).sort((a, b) => b.records - a.records).slice(0, 10)
            };
        });

        return successResponse(res, {
            summary: {
                totalCountries: countriesMap.size,
                totalCategories,
                totalRecords
            },
            countries: countryStats
        }, 'Stats fetched successfully');
    } catch (error) {
        console.error('Error fetching merged stats:', error);
        return errorResponse(res, 'Failed to fetch stats', 500, error.message);
    }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Quick line count without parsing full CSV (much faster than csv-parser for counting)
 */
function quickLineCount(filePath) {
    return new Promise((resolve, reject) => {
        let lineCount = 0;
        fs.createReadStream(filePath)
            .on('data', (buffer) => {
                let idx = -1;
                lineCount--; // Because the first line is the header
                do {
                    idx = buffer.indexOf(10, idx + 1); // 10 = newline character
                    lineCount++;
                } while (idx !== -1);
            })
            .on('end', () => {
                resolve(Math.max(0, lineCount)); // Subtract 1 for header row
            })
            .on('error', (err) => reject(err));
    });
}

/**
 * Format file size to human readable
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Get country name from code
 */
function getCountryName(code) {
    const countries = {
        'US': 'United States',
        'UK': 'United Kingdom',
        'CA': 'Canada',
        'AU': 'Australia',
        'IN': 'India',
        'DE': 'Germany',
        'FR': 'France',
        'JP': 'Japan',
        'BR': 'Brazil',
        'MX': 'Mexico',
        'AT': 'Austria'
    };
    if (countries[code.toUpperCase()]) return countries[code.toUpperCase()];
    
    // Dynamic fallback to exact folder name on disk to prevent Linux case-sensitivity issues
    try {
        if (fs.existsSync(SAMPLE_DATA_BASE)) {
            const items = fs.readdirSync(SAMPLE_DATA_BASE, { withFileTypes: true });
            const match = items.find(item => item.isDirectory() && item.name.toUpperCase() === code.toUpperCase());
            if (match) return match.name;
        }
    } catch(e) {}

    return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase(); // basic fallback
}
