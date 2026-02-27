const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BASE_DATA_PATH = process.env.DATA_PATH || '/home/scrappingscript/scrappingscript/scraped_data';
const CACHE_DIR = path.join(BASE_DATA_PATH, 'US_Merged', '.cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function formatCategoryName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Map of state abbreviations to full names if needed, but if folder is "CA", we can store it under "CA" or map to "California"
// The frontend uses full state names like "California", "Arizona", etc.
const STATE_MAP = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 
    'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 
    'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland', 'MA': 'Massachusetts', 
    'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 
    'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina', 
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'Washington DC'
};

// FAST: Count lines in a file and check headers
function countLinesAndFields(filePath) {
    return new Promise((resolve) => {
        let total = 0;
        let hasEmail = false;
        let hasPhone = false;
        let hasWebsite = false;
        let isFirstLine = true;

        const rl = readline.createInterface({
            input: fs.createReadStream(filePath, { encoding: 'utf8' }),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            if (isFirstLine) {
                const header = line.toLowerCase();
                hasEmail = header.includes('email');
                hasPhone = header.includes('phone');
                hasWebsite = header.includes('website') || header.includes('url');
                isFirstLine = false;
            } else if (line.trim()) {
                total++;
            }
        });

        rl.on('close', () => {
            resolve({ total, hasEmail, hasPhone, hasWebsite });
        });

        rl.on('error', () => {
            resolve({ total: 0, hasEmail: false, hasPhone: false, hasWebsite: false });
        });
    });
}

// Run the precomputation
async function run() {
    const countryFolder = path.join(BASE_DATA_PATH, 'US');
    if (!fs.existsSync(countryFolder)) {
        console.error(`Country folder not found: ${countryFolder}`);
        process.exit(1);
    }

    console.log(`Scanning unmerged data in ${countryFolder}...`);
    const startTime = Date.now();

    // { "california": { "los_angeles": { "restaurants": { records: 10, ... } } } }
    const cacheData = {};

    // 1. Iterate over State folders (e.g. AL, CA, TX, or full names)
    const stateDirs = fs.readdirSync(countryFolder, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    for (const stateFolderName of stateDirs) {
        // Map abbreviation to full name if applicable (e.g., CA -> California)
        const fullStateName = STATE_MAP[stateFolderName.toUpperCase()] || stateFolderName;
        const lowerStateName = fullStateName.toLowerCase();

        const statePath = path.join(countryFolder, stateFolderName);
        console.log(`Processing State: ${fullStateName} (${stateFolderName})...`);

        if (!cacheData[lowerStateName]) {
            cacheData[lowerStateName] = { 
                _global_categories: {} // State-level category totals
            };
        }

        // 2. Iterate over City folders inside the state
        const cityDirs = fs.readdirSync(statePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const cityName of cityDirs) {
            const lowerCityName = cityName.toLowerCase();
            const cityPath = path.join(statePath, cityName);

            // 3. Iterate over CSV files inside the city
            const csvFiles = fs.readdirSync(cityPath).filter(f => f.endsWith('.csv'));

            for (const file of csvFiles) {
                const categoryRaw = file.replace('.csv', '');
                const filePath = path.join(cityPath, file);

                // Count the rows in this CSV
                const stats = await countLinesAndFields(filePath);
                if (stats.total === 0) continue;

                // --- 1. Add to City-level totals ---
                if (!cacheData[lowerStateName][lowerCityName]) {
                    cacheData[lowerStateName][lowerCityName] = {};
                }
                
                if (!cacheData[lowerStateName][lowerCityName][categoryRaw]) {
                    cacheData[lowerStateName][lowerCityName][categoryRaw] = {
                        name: categoryRaw,
                        displayName: formatCategoryName(categoryRaw),
                        records: 0,
                        hasEmail: stats.hasEmail,
                        hasPhone: stats.hasPhone,
                        hasWebsite: stats.hasWebsite
                    };
                }
                cacheData[lowerStateName][lowerCityName][categoryRaw].records += stats.total;
                // Update bools if any file has them
                cacheData[lowerStateName][lowerCityName][categoryRaw].hasEmail ||= stats.hasEmail;
                cacheData[lowerStateName][lowerCityName][categoryRaw].hasPhone ||= stats.hasPhone;
                cacheData[lowerStateName][lowerCityName][categoryRaw].hasWebsite ||= stats.hasWebsite;

                // --- 2. Add to State-level totals ---
                if (!cacheData[lowerStateName]._global_categories[categoryRaw]) {
                    cacheData[lowerStateName]._global_categories[categoryRaw] = {
                        name: categoryRaw,
                        displayName: formatCategoryName(categoryRaw),
                        records: 0,
                        hasEmail: stats.hasEmail,
                        hasPhone: stats.hasPhone,
                        hasWebsite: stats.hasWebsite
                    };
                }
                cacheData[lowerStateName]._global_categories[categoryRaw].records += stats.total;
                cacheData[lowerStateName]._global_categories[categoryRaw].hasEmail ||= stats.hasEmail;
                cacheData[lowerStateName]._global_categories[categoryRaw].hasPhone ||= stats.hasPhone;
                cacheData[lowerStateName]._global_categories[categoryRaw].hasWebsite ||= stats.hasWebsite;
            }
        }
        
        // --- Write State Level Cache ---
        const stateCategories = Object.values(cacheData[lowerStateName]._global_categories);
        if (stateCategories.length > 0) {
            stateCategories.sort((a, b) => a.displayName.localeCompare(b.displayName));
            const stateCacheFile = path.join(CACHE_DIR, `us_state_${lowerStateName.replace(/\s+/g, '_')}.json`);
            
            fs.writeFileSync(stateCacheFile, JSON.stringify({
                country: 'US',
                state: fullStateName,
                city: '',
                totalCategories: stateCategories.length,
                categories: stateCategories
            }));
            console.log(`  -> Generated cache for state: ${fullStateName}`);
        }

        // --- Write City Level Caches ---
        for (const [cityKey, cityCatsMap] of Object.entries(cacheData[lowerStateName])) {
            if (cityKey === '_global_categories') continue; // Skip global
            
            const cityCategories = Object.values(cityCatsMap);
            if (cityCategories.length > 0) {
                cityCategories.sort((a, b) => a.displayName.localeCompare(b.displayName));
                
                // Keep original casing for output if possible. We'll find it by doing a lookup or just using a title case
                const displayCityName = cityKey.replace(/(^\w|\s\w)/g, m => m.toUpperCase()); 
                
                const cityCacheFile = path.join(CACHE_DIR, `us_state_${lowerStateName.replace(/\s+/g, '_')}_city_${cityKey.replace(/\s+/g, '_')}.json`);
                fs.writeFileSync(cityCacheFile, JSON.stringify({
                    country: 'US',
                    state: fullStateName,
                    city: displayCityName,
                    totalCategories: cityCategories.length,
                    categories: cityCategories
                }));
            }
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nAll done! Precomputed cache generated in ${elapsed}s.`);
}

run();
