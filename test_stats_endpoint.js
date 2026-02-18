const http = require('http');

const checkEndpoint = (path) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 6969, // Updated from app.js
            path: path,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                console.log(`[${res.statusCode}] ${path}`);
                if (res.statusCode === 200) {
                     try {
                        const json = JSON.parse(data);
                        console.log("Response Preview:", JSON.stringify(json).substring(0, 200) + "...");
                     } catch(e) {
                        console.log("Response (Not JSON):", data.substring(0, 200));
                     }
                } else {
                    console.log("Error Response:", data);
                }
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request to ${path}: ${e.message}`);
            resolve(); // Resolve to keep script running
        });

        req.end();
    });
};

const checkPostEndpoint = (path, body) => {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(body);
        const options = {
            hostname: 'localhost',
            port: 6969,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`[${res.statusCode}] POST ${path}`);
                console.log("Response:", data.substring(0, 200));
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request to ${path}: ${e.message}`);
            resolve();
        });

        req.write(postData);
        req.end();
    });
};

const run = async () => {
    console.log("1. Fetching Admin Datasets to find a target...");
    const listRes = await new Promise((resolve) => {
        http.get('http://localhost:6969/api/scraper/admin/datasets', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });

    if (!listRes.success || listRes.data.length === 0) {
        console.error("No datasets found to test.");
        return;
    }

    const target = listRes.data[0];
    console.log(`target file: ${target._id}`);
    
    // Construct ID for public API: category-in-location
    // target.location is "City, State, Country"
    // target.category is "Category"
    // We need slug format.
    const toSlug = (str) => str.toLowerCase().replace(/ /g, '-').replace(/,/g, '');
    // Public ID format is tricky: category-in-location-slug
    // locSlug in backend is split by '-' and matched against path tokens.
    // So "category-in-city-state-country" should work.
    
    const catSlug = target.category.toLowerCase().replace(/ /g, '-');
    const locSlug = target.location.toLowerCase().replace(/, /g, '-').replace(/ /g, '-');
    const publicId = `${catSlug}-in-${locSlug}`;
    console.log(`Generated Public ID: ${publicId}`);

    console.log("\n2. Fetching Initial Detail...");
    await checkEndpoint(`/api/scraper/dataset/${publicId}`);

    console.log("\n3. Updating Price to $999...");
    await checkPostEndpoint('/api/scraper/dataset/update-price', { 
        filePath: target._id,
        price: '$999',
        previousPrice: '$1999'
    });

    console.log("\n4. Fetching Detail AGAIN to verify...");
    await checkEndpoint(`/api/scraper/dataset/${publicId}`);
};

run();
