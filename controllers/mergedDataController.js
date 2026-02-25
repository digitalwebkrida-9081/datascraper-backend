const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Base path where merged data lives on the VPS
const MERGED_DATA_BASE = process.env.MERGED_DATA_PATH || '/home/scrappingscript/scrappingscript/scraped_data';

/**
 * Helper: Get the merged folder name for a country code
 * e.g. "US" -> "US_Merged"
 */
function getMergedDir(countryCode) {
    return path.join(MERGED_DATA_BASE, `${countryCode.toUpperCase()}_Merged`);
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
 * Lists all available countries that have merged data
 */
exports.getCountries = async (req, res) => {
    try {
        if (!fs.existsSync(MERGED_DATA_BASE)) {
            return errorResponse(res, 'Merged data directory not found', 404);
        }

        const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
        const countries = items
            .filter(item => item.isDirectory() && item.name.endsWith('_Merged'))
            .map(item => {
                const code = item.name.replace('_Merged', '');
                const mergedDir = path.join(MERGED_DATA_BASE, item.name);
                const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
                return {
                    code: code,
                    name: getCountryName(code),
                    totalCategories: csvFiles.length,
                    folderName: item.name
                };
            });

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

        if (!fs.existsSync(mergedDir)) {
            return errorResponse(res, `No merged data found for country: ${country}`, 404);
        }

        const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));

        const categories = [];
        for (const file of csvFiles) {
            const categoryName = file.replace('.csv', '');
            const filePath = path.join(mergedDir, file);
            const stat = fs.statSync(filePath);

            categories.push({
                name: categoryName,
                displayName: formatCategoryName(categoryName),
                fileName: file,
                fileSize: stat.size,
                fileSizeFormatted: formatFileSize(stat.size),
                lastModified: stat.mtime
            });
        }

        // Sort alphabetically
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
 * Returns paginated data from a specific merged CSV file
 */
exports.getMergedData = async (req, res) => {
    try {
        const { country, category, page = 1, limit = 20, search = '' } = req.query;

        if (!country || !category) {
            return errorResponse(res, 'Country and category parameters are required', 400);
        }

        const mergedDir = getMergedDir(country);
        const filePath = path.join(mergedDir, `${category}.csv`);

        if (!fs.existsSync(filePath)) {
            return errorResponse(res, `Data not found for ${category} in ${country}`, 404);
        }

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const result = await readCsvPaginated(filePath, pageNum, limitNum, search);

        return successResponse(res, {
            country: country.toUpperCase(),
            category: formatCategoryName(category),
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
        if (!fs.existsSync(MERGED_DATA_BASE)) {
            return errorResponse(res, 'Merged data directory not found', 404);
        }

        const items = fs.readdirSync(MERGED_DATA_BASE, { withFileTypes: true });
        const mergedFolders = items.filter(item => item.isDirectory() && item.name.endsWith('_Merged'));

        let totalRecords = 0;
        let totalCategories = 0;
        let totalCountries = mergedFolders.length;
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
                const categoryName = file.replace('.csv', '');

                // Estimate record count from file size (approx ~200 bytes per row for CSVs)
                // For accurate counts, we'd need to parse each file which is slow
                // We'll use file line count as an approximation
                const lineCount = await quickLineCount(filePath);

                countryRecords += lineCount;
                countryTotalSize += stat.size;

                categoryList.push({
                    name: formatCategoryName(categoryName),
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
                categories: categoryList.sort((a, b) => b.records - a.records).slice(0, 10) // Top 10 categories
            });
        }

        return successResponse(res, {
            summary: {
                totalCountries,
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
        'MX': 'Mexico'
    };
    return countries[code.toUpperCase()] || code.toUpperCase();
}
