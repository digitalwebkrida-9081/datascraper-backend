const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..', 'datascrapper');

if (!fs.existsSync(baseDir)) {
    console.error('Datascrapper directory not found');
    process.exit(1);
}

const cacheFile = path.join(baseDir, '_admin_datasets_cache.json');

const sanitize = (name) => (name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
const cleanName = (str) => str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

async function buildCache() {
    console.log('Building cache for B2B datasets...');
    let filelist = [];
    
    // Find all JSON files iteratively to avoid deep recursion issues
    const stack = [baseDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filepath = path.join(dir, file);
            const stat = fs.statSync(filepath);
            if (stat.isDirectory()) {
                if (file !== 'misc' && file !== 'coordinates' && file !== 'purchases' && file !== '.cache') {
                    stack.push(filepath);
                }
            } else if (file.endsWith('.json') && !file.endsWith('.metadata.json') && file !== '_admin_datasets_cache.json') {
                filelist.push(filepath);
            }
        }
    }

    console.log(`Found ${filelist.length} dataset files. Processing...`);

    let datasets = [];
    let count = 0;

    for (const filepath of filelist) {
        count++;
        if (count % 500 === 0) {
            console.log(`Processed ${count}/${filelist.length}`);
        }

        const relativePath = path.relative(baseDir, filepath);
        const parts = relativePath.split(path.sep);
             
        let dCountry = '', dState = '', dCity = '', dCategory = '';
             
        if (parts.length >= 4) {
            dCountry = parts[0];
            dState = parts[1];
            dCity = parts[2];
            dCategory = parts[3].replace('.json', '');
        } else {
            dCategory = parts[parts.length - 1].replace('.json', '');
            dCountry = parts[0];
        }

        try {
            const stat = fs.statSync(filepath);
            const content = fs.readFileSync(filepath, 'utf-8');
            let dataLength = 0;
            let sampleList = [];

            // Lightweight parsing or full parse
            try {
                const data = JSON.parse(content);
                dataLength = data.length || 0;
                sampleList = data.slice(0, 3);
            } catch(e) {
                // If JSON is malformed, skip
                continue;
            }

            let filePrice = "$199";
            const metaPath = filepath.replace('.json', '.metadata.json');
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    if (meta.price) filePrice = meta.price;
                } catch(e) {}
            }

            datasets.push({
                _id: relativePath.replace(/\\/g, '/'),
                 location: `${cleanName(dCity)}, ${cleanName(dState)}, ${cleanName(dCountry)}`,
                 category: cleanName(dCategory),
                 totalRecords: dataLength,
                 price: filePrice, 
                 lastUpdate: stat.mtime,
                 sampleList: sampleList,
                 // Also store raw parts for easy filtering
                 _rawCountry: sanitize(dCountry),
                 _rawState: sanitize(dState),
                 _rawCity: sanitize(dCity),
                 _rawCategory: sanitize(dCategory)
            });
        } catch (e) {
            console.error("Error parsing:", filepath);
        }
    }

    datasets.sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));

    fs.writeFileSync(cacheFile, JSON.stringify(datasets, null, 2));
    console.log(`Cache generated successfully! Formatted ${datasets.length} datasets.`);
}

buildCache().catch(console.error);
