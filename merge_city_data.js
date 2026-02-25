const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// ==========================================
// CONFIGURATION
// ==========================================
// Updated to look inside the UK folder
const sourceDataDir = '/home/scrappingscript/scrappingscript/scraped_data/UK'; 
const outputDir = '/home/scrappingscript/scrappingscript/scraped_data/UK_Merged';

// ==========================================
// MERGE SCRIPT
// ==========================================

if (!fs.existsSync(sourceDataDir)) {
    console.error(`❌ Source directory not found: ${sourceDataDir}`);
    process.exit(1);
}

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

function getUniqueKey(item) {
    if (item.place_id) return item.place_id;
    if (item.google_maps_url) return item.google_maps_url;
    if (item['Google Maps URL']) return item['Google Maps URL'];
    if (item.googleMapsUri) return item.googleMapsUri;
    return `${item.name || item.Name || 'Unknown'}_${item.full_address || item.Address || 'Unknown'}`;
}

// Recursively find all .csv files
function findCsvFiles(dir, fileList = []) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        if (item.isDirectory() && path.join(dir, item.name) === outputDir) continue;
        if (item.name.startsWith('.')) continue;
        
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            findCsvFiles(fullPath, fileList);
        } else if (item.isFile() && item.name.endsWith('.csv')) {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

function processCsvFile(filePath) {
    return new Promise((resolve) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => {
                console.error(`⚠️ Error reading ${filePath}: ${err.message}`);
                resolve([]);
            });
    });
}

function getMemoryUsage() {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

async function mergeData() {
    console.log(`Starting data merge from: ${sourceDataDir}`);
    console.log(`Output directory: ${outputDir}\n`);

    try {
        console.log(`Scanning for CSV files...`);
        const allCsvFiles = findCsvFiles(sourceDataDir);
        console.log(`Found ${allCsvFiles.length} total CSV files.\n`);

        // 1. Group files by Category first (Map<Category, Array<FilePath>>)
        // This barely takes any memory compared to loading the data
        const categoryMap = {};
        
        for (const filePath of allCsvFiles) {
            const fileName = path.basename(filePath);
            const category = fileName.replace('.csv', '');
            
            if (!categoryMap[category]) {
                categoryMap[category] = [];
            }
            categoryMap[category].push(filePath);
        }

        const categories = Object.keys(categoryMap);
        console.log(`Identified ${categories.length} unique categories to merge.\n`);

        // 2. Process each category one by one
        // This ensures we only hold ONE category in memory at a time
        for (let i = 0; i < categories.length; i++) {
            const category = categories[i];
            const files = categoryMap[category];
            
            console.log(`Processing [${category}] (${i + 1}/${categories.length}) - ${files.length} files...`);

            const seenKeys = new Set();
            const mergedItems = [];
            
            // Read all files for this category
            for (const filePath of files) {
                const data = await processCsvFile(filePath);
                for (const item of data) {
                    const key = getUniqueKey(item);
                    if (key !== 'Unknown_Unknown' && !seenKeys.has(key)) {
                        seenKeys.add(key);
                        mergedItems.push(item);
                    }
                }
            }
            
            // Write output for this category immediately
            if (mergedItems.length > 0) {
                const csvOutputPath = path.join(outputDir, `${category}.csv`);
                try {
                    // Extract headers dynamically
                    const headerSet = new Set();
                    for (const item of mergedItems) {
                        Object.keys(item).forEach(key => headerSet.add(key));
                    }
                    const headers = Array.from(headerSet).map(header => ({ id: header, title: header }));

                    const csvWriter = createCsvWriter({
                        path: csvOutputPath,
                        header: headers
                    });

                    await csvWriter.writeRecords(mergedItems);
                    console.log(`  -> Saved ${csvOutputPath} (${mergedItems.length} items)`);
                } catch (err) {
                    console.error(`⚠️ Failed to write output for [${category}]: ${err.message}`);
                }
            }

            // FORCE CLEANUP
            // We set these to null explicitly to help the Garbage Collector
            // It is critical to do this before moving to the next category
            mergedItems.length = 0;
            seenKeys.clear();
            
            if (global.gc) {
                global.gc();
                const memUsage = getMemoryUsage();
                // process.stdout.write(`  (GC Ran - Mem: ${memUsage} MB)\n`);
            } else {
                // advise user if they forgot --expose-gc
                // const memUsage = getMemoryUsage();
                // process.stdout.write(`  (Mem: ${memUsage} MB)\n`);
            }
        }
        
        console.log(`\n🎉 Success! All data has been merged into: ${outputDir}`);

    } catch (err) {
        console.error('❌ An unexpected error occurred:', err);
    }
}

mergeData();
