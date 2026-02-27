const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const MERGED_DATA_BASE = process.env.MERGED_DATA_PATH || '/home/scrappingscript/scrappingscript/scraped_data';
const CACHE_DIR = path.join(MERGED_DATA_BASE, '.cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getMergedDir(countryCode) {
    return path.join(MERGED_DATA_BASE, `${countryCode.toUpperCase()}_Merged`);
}

function formatCategoryName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Map of common states for pre-computation (Add more as needed)
const TARGET_STATES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 
    'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 
    'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 
    'Wisconsin', 'Wyoming', 'Washington DC', 'Puerto Rico'
];

// FAST: Count rows matching ALL states locally in one pass per file
function countAllStatesFast(filePath) {
    return new Promise((resolve) => {
        const stateCounts = {};
        for (const s of TARGET_STATES) {
            stateCounts[s.toLowerCase()] = { total: 0, hasEmail: false, hasPhone: false, hasWebsite: false };
        }
        
        let isFirstLine = true;
        let hasEmail = false;
        let hasPhone = false;
        let hasWebsite = false;
        let remainder = '';

        const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 128 * 1024 });
        
        stream.on('data', (chunk) => {
            const text = remainder + chunk;
            const lines = text.split('\n');
            remainder = lines.pop(); // Save incomplete last line
            
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
                
                const lowerLine = line.toLowerCase();
                
                // Check against all target states
                for (const state of TARGET_STATES) {
                    const lowerState = state.toLowerCase();
                    if (lowerLine.includes(lowerState)) {
                        stateCounts[lowerState].total++;
                        stateCounts[lowerState].hasEmail = hasEmail;
                        stateCounts[lowerState].hasPhone = hasPhone;
                        stateCounts[lowerState].hasWebsite = hasWebsite;
                        // Assuming a row only matches one state, we can break early
                        break;
                    }
                }
            }
        });
        
        stream.on('end', () => {
            if (remainder.trim() && !isFirstLine) {
                const lowerLine = remainder.toLowerCase();
                for (const state of TARGET_STATES) {
                    const lowerState = state.toLowerCase();
                    if (lowerLine.includes(lowerState)) {
                        stateCounts[lowerState].total++;
                        stateCounts[lowerState].hasEmail = hasEmail;
                        stateCounts[lowerState].hasPhone = hasPhone;
                        stateCounts[lowerState].hasWebsite = hasWebsite;
                        break;
                    }
                }
            }
            resolve(stateCounts);
        });
        
        stream.on('error', () => resolve(stateCounts)); // Return whatever we have on error
    });
}

async function buildCacheForCountry(countryCode) {
    console.log(`\n=== Building Cache for ${countryCode} ===`);
    const mergedDir = getMergedDir(countryCode);
    
    if (!fs.existsSync(mergedDir)) {
        console.log(`Directory not found: ${mergedDir}`);
        return;
    }

    const csvFiles = fs.readdirSync(mergedDir).filter(f => f.endsWith('.csv'));
    console.log(`Found ${csvFiles.length} limit files to process.\n`);
    
    const startTime = Date.now();
    
    // Initialize empty cache structure: { "arizona": [ {category objects} ] }
    const fullCache = {};
    for (const s of TARGET_STATES) {
        fullCache[s.toLowerCase()] = [];
    }

    // Process files sequentially to avoid blowing up memory during massive scans, 
    // but the single-pass nature makes it very fast per file.
    let count = 0;
    for (const file of csvFiles) {
        count++;
        const categoryName = file.replace('.csv', '');
        const displayName = formatCategoryName(categoryName);
        const filePath = path.join(mergedDir, file);
        
        process.stdout.write(`\rProcessing [${count}/${csvFiles.length}]: ${categoryName}...                    `);
        
        const stateCountsForFile = await countAllStatesFast(filePath);
        
        // Populate the full cache
        for (const [lowerState, counts] of Object.entries(stateCountsForFile)) {
            if (counts.total > 0) {
                fullCache[lowerState].push({
                    name: categoryName,
                    displayName: displayName,
                    records: counts.total,
                    hasEmail: counts.hasEmail,
                    hasPhone: counts.hasPhone,
                    hasWebsite: counts.hasWebsite
                });
            }
        }
    }

    console.log(`\n\nWriting cache files...`);
    
    // Write individual cache files per state
    let validStatesCount = 0;
    for (const [lowerState, categories] of Object.entries(fullCache)) {
        if (categories.length > 0) {
            // Sort categories for consistency
            categories.sort((a, b) => a.displayName.localeCompare(b.displayName));
            
            const cacheFilePath = path.join(CACHE_DIR, `${countryCode.toLowerCase()}_state_${lowerState.replace(/\s+/g, '_')}.json`);
            fs.writeFileSync(cacheFilePath, JSON.stringify({
                country: countryCode.toUpperCase(),
                state: TARGET_STATES.find(s => s.toLowerCase() === lowerState),
                city: '',
                totalCategories: categories.length,
                categories: categories
            }));
            validStatesCount++;
        }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Done! Built cache for ${validStatesCount} states in ${elapsed}s.`);
}

async function run() {
    console.log("Starting Pre-computation Cache Worker...");
    // Just run US for now as an example
    await buildCacheForCountry('US');
    console.log("\nAll caching complete.");
}

run();
