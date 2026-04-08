const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Configuration
const BACKEND_DIR = path.join(__dirname, '..');
const RECORDS_FILE = path.join(BACKEND_DIR, '_records.json');
const UPLOADS_DIR = path.join(BACKEND_DIR, 'uploads');
const EXCEL_FILE = path.join(UPLOADS_DIR, 'update_counts.xlsx');

// Helper to normalize country from URL (e.g. "united-kingdom" -> "United Kingdom")
function normalizeLocation(loc) {
    if (!loc) return '';
    const countries = {
        'united-kingdom': 'United Kingdom',
        'united-states': 'United States',
        'us': 'United States',
        'uk': 'United Kingdom',
        'gb': 'United Kingdom'
    };
    const lower = loc.toLowerCase().trim();
    if (countries[lower]) return countries[lower];
    
    return loc.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Helper to normalize category (e.g. "Health-resorts" -> "health_resorts")
function normalizeCategory(cat) {
    if (!cat) return '';
    return cat.replace(/-/g, '_').toLowerCase().trim();
}

// Mock of getCountryName from server.js for key generation
function getCountryName(code) {
    const countries = {
        'US': 'United States', 'UK': 'United Kingdom', 'CA': 'Canada',
        'AU': 'Australia', 'IN': 'India', 'DE': 'Germany',
        'FR': 'France', 'JP': 'Japan', 'BR': 'Brazil', 'MX': 'Mexico',
        'AT': 'Austria', 'GERMANY': 'Germany', 'FRANCE': 'France'
    };
    if (countries[code.toUpperCase()]) return countries[code.toUpperCase()];
    return code.length > 2 ? code.charAt(0).toUpperCase() + code.slice(1).toLowerCase() : code.toUpperCase();
}

function getCacheKey(country, state = '', city = '', category = '') {
    const resolvedCountry = country ? getCountryName(country).toUpperCase() : '';
    return [
        resolvedCountry,
        state?.toLowerCase().trim() || '',
        city?.toLowerCase().trim() || '',
        category?.toLowerCase().trim() || ''
    ].join('_||_');
}

async function bulkUpdate() {
    process.stdout.write('Starting Bulk Update of Record Digits...\n');

    if (!fs.existsSync(EXCEL_FILE)) {
        process.stdout.write(`❌ Excel file not found at: ${EXCEL_FILE}\n`);
        process.stdout.write(`Please place your file there and rename it to 'update_counts.xlsx'\n`);
        return;
    }

    // 1. Read Excel
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    process.stdout.write(`Found ${data.length} rows in Excel.\n`);

    // 2. Load existing records
    let records = {};
    if (fs.existsSync(RECORDS_FILE)) {
        try {
            records = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
            process.stdout.write(`Loaded existing _records.json (${Object.keys(records).length} entries).\n`);
        } catch (e) {
            process.stdout.write(`⚠️ Error parsing _records.json, starting fresh.\n`);
        }
    }

    const affectedCountries = new Set();
    let updatedCount = 0;

    // 3. Process each row
    for (const row of data) {
        const url = row.links || row.Links || row.url || row.URL || '';
        if (!url) continue;

        try {
            // Extract slug (last part of URL)
            const slug = url.split('/').filter(Boolean).pop();
            const match = slug.match(/^leads-list-of-(.+)-in-(.+)$/);
            
            if (!match) {
                process.stdout.write(`⚠️ Could not parse URL: ${url}\n`);
                continue;
            }

            const rawCategory = match[1];
            const rawLocation = match[2];

            let country = rawLocation;
            let state = '';
            let city = '';

            // Handle potential city-in-state-in-country format
            if (rawLocation.includes('-in-')) {
                 const parts = rawLocation.split('-in-');
                 if (parts.length === 3) {
                     city = parts[0];
                     state = parts[1];
                     country = parts[2];
                 } else if (parts.length === 2) {
                     state = parts[0];
                     country = parts[1];
                 }
            }
            
            const normalizedCountry = normalizeLocation(country);
            const normalizedCategory = normalizeCategory(rawCategory);
            
            const key = getCacheKey(normalizedCountry, state, city, normalizedCategory);
            
            // Map columns
            const getVal = (val) => {
                if (val === undefined || val === null || val === '') return '';
                return String(val).replace(/[^0-9]/g, '');
            };

            records[key] = {
                category: normalizedCategory, // Store for reference
                total: getVal(row.Number),
                emails: getVal(row.Email),
                phones: getVal(row.Phone),
                websites: getVal(row.Website),
                linkedin: getVal(row.Linkdin || row.LinkedIn),
                facebook: getVal(row.Facebook),
                instagram: getVal(row.Instagram),
                twitter: getVal(row.Twitter),
                tiktok: getVal(row['Tik Tok'] || row.TikTok),
                youtube: getVal(row['You Tube'] || row.YouTube)
            };

            affectedCountries.add(normalizedCountry);
            updatedCount++;

        } catch (err) {
            process.stdout.write(`❌ Error processing row for ${url}: ${err.message}\n`);
        }
    }

    // 4. Save records
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2), 'utf8');
    process.stdout.write(`\n🎉 Success! Updated ${updatedCount} dataset records in _records.json.\n`);

    // 5. Invalidate Caches
    process.stdout.write(`Invalidating caches for affected countries...\n`);
    for (const country of affectedCountries) {
        const items = fs.readdirSync(BACKEND_DIR);
        const match = items.find(item => item.endsWith('_Merged') && item.toUpperCase().includes(country.toUpperCase().replace(/\s+/g, '')));
        
        if (match) {
            const subCache = path.join(BACKEND_DIR, match, '_categories_cache_v2.json');
            if (fs.existsSync(subCache)) {
                fs.unlinkSync(subCache);
                process.stdout.write(`  🗑️ Deleted cache: ${subCache}\n`);
            }
        }
    }

    process.stdout.write(`\nDone! The updated counts should now reflect in the Admin Panel.\n`);
}

bulkUpdate().catch(console.error);
