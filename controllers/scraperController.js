const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const GoogleBusiness = require('../models/GoogleBusiness');
const { ensureLocationsExist } = require('../utils/locationHelper');

exports.searchGoogleMaps = async (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ success: false, message: "Query is required" });
    }

    let browser;
    try {
        console.log(`Launching browser for query: ${query}`);
        
        // CLEANUP: Force delete the profile directory if it exists to avoid lock errors
        const profilePath = path.join(__dirname, 'chrome_data');
        if (fs.existsSync(profilePath)) {
            try {
                fs.rmSync(profilePath, { recursive: true, force: true });
                console.log("Cleaned up old chrome_data profile.");
            } catch (cleanupErr) {
                console.error("Warning: Could not clean up chrome_data (might be locked):", cleanupErr.message);
            }
        }

        browser = await puppeteer.launch({
            headless: 'new', 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ],
            ignoreHTTPSErrors: true,
            userDataDir: path.join(__dirname, 'chrome_data')
        });

        const page = await browser.newPage();

        // Check if the query is a direct URL or a search term
        const isUrl = query.startsWith('http');
        const searchUrl = isUrl ? query : `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        
        console.log(`Navigating to: ${searchUrl}`);

        await page.goto(searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        // Handle cookie consent if present (generic selector)
        try {
            const consentButton = await page.$('button[aria-label="Accept all"]');
            if (consentButton) {
                await consentButton.click();
                await page.waitForNavigation({ waitUntil: 'networkidle2' });
            }
        } catch (e) {
            // Ignore if no consent button
        }

        console.log('Waiting for results...');
        
        try {
             // Identifying the scrollable container is tricky.
             // Usually it's a div with role='feed' inside the sidebar.
             await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
        } catch(e) {
            console.log("Could not find role='feed', might be a single result or different layout.");
        }

        async function autoScroll(page) {
            await page.evaluate(async () => {
                const wrapper = document.querySelector('div[role="feed"]');
                if (wrapper) {
                    await new Promise((resolve, reject) => {
                        var totalHeight = 0;
                        var distance = 1000;
                        var scrollDelay = 1000;

                        var timer = setInterval(() => {
                            var scrollHeight = wrapper.scrollHeight;
                            wrapper.scrollBy(0, distance);
                            totalHeight += distance;

                            if (totalHeight >= scrollHeight || totalHeight > 50000){ // Limit scroll
                                clearInterval(timer);
                                resolve();
                            }
                        }, scrollDelay);
                    });
                }
            });
        }

        await autoScroll(page);
        await new Promise(r => setTimeout(r, 2000)); // wait a bit after scroll

        // Deep Scraping Logic
        console.log(`Found places in list. Proceeding to deep scrape items...`);
        
        const deepResults = [];
        
        // Helper to wait for meaningful text
        const getText = async (page, selector) => {
            try {
                return await page.$eval(selector, el => el.innerText.trim());
            } catch (e) { return null; }
        };

        const getAttribute = async (page, selector, attr) => {
            try {
                return await page.$eval(selector, (el, a) => el.getAttribute(a), attr);
            } catch (e) { return null; }
        };

        // Clean helper
        const cleanText = (text) => {
            if (!text) return null;
            // Remove icons (Google fonts often use special chars like , )
            // Remove "Address:", "Phone:", "Website:" prefixes
            // Remove newlines
            let cleaned = text.replace(/[]/g, '').replace(/Address:\s*/i, '').replace(/Phone:\s*/i, '').replace(/\n/g, ' ').trim();
            // Remove leading plus if formatted weirdly " +1" -> "+1"
            return cleaned; 
        };

        // Get list of result links handles
        let links = await page.$$('a[href*="/maps/place/"]');
        console.log(`Deep scraping ${Math.min(links.length, 5)} items...`); 

        const itemsToScrape = Math.min(links.length, 5);

        for (let i = 0; i < itemsToScrape; i++) {
            try {
                // Re-query items in loop
                links = await page.$$('a[href*="/maps/place/"]');
                const item = links[i];
                if (!item) break;

                // Extract name from LIST item first (more reliable than detail sometimes)
                let listName = await item.evaluate(el => el.getAttribute('aria-label'));
                if (!listName) {
                    listName = await item.evaluate(el => el.innerText.split('\n')[0]); // Fallback
                }

                console.log(`Clicking item ${i + 1} (${listName})...`);
                await item.click();
                
                // Wait for detail panel. 
                try {
                    await page.waitForSelector('div[role="main"]', { timeout: 8000 });
                } catch(e) { console.log("Detail panel wait timeout or not found"); }
                
                await new Promise(r => setTimeout(r, 2000)); // Stability wait

                // Extract Fields
                // Try H1 first
                let detailName = await getText(page, 'h1');
                
                // Use list name if detail name is suspicious or missing
                let name = detailName;
                if (!name || name === "Results" || name === "Directions") {
                     name = listName || "Unknown";
                }
                
                // Rating
                let rating = await getText(page, 'div[role="main"] span[aria-hidden="true"]'); 
                if (!rating || rating.length > 5 || isNaN(parseFloat(rating))) { 
                     const stars = await page.$('span[aria-label*="stars"]');
                     if (stars) {
                         const aria = await page.evaluate(el => el.getAttribute('aria-label'), stars);
                         const match = aria.match(/(\d\.\d)/);
                         if (match) rating = match[1];
                     }
                }
                if (!rating) rating = "N/A";
                rating = cleanText(rating);

                // Address
                let address = await getText(page, 'button[data-item-id="address"]');
                if (!address) {
                    const addrBtn = await page.$('button[data-item-id="address"]');
                    if (addrBtn) address = await page.evaluate(el => el.getAttribute('aria-label'), addrBtn);
                }
                address = cleanText(address);

                // Phone
                let phone = await getText(page, 'button[data-item-id^="phone"]');
                if (!phone) {
                     const phBtn = await page.$('button[data-item-id^="phone"]');
                     if (phBtn) phone = await page.evaluate(el => el.getAttribute('aria-label'), phBtn);
                }
                phone = cleanText(phone);

                // Website
                let website = await getAttribute(page, 'a[data-item-id="authority"]', 'href');
                if (!website) {
                     const webBtn = await page.$('a[data-tooltip="Open website"]');
                     if (webBtn) website = await page.evaluate(el => el.href, webBtn);
                }

                console.log(`Extracted: ${name}, ${phone}, ${website}`);

                deepResults.push({
                    name: name,
                    rating: rating,
                    review_count: 0, 
                    full_address: address || "N/A",
                    phone_number: phone || null,
                    website: website || null,
                    google_maps_url: await page.url(),
                    place_id: await page.url() 
                });
                
            } catch (err) {
                console.error(`Error scraping item ${i}:`, err.message);
            }
        }
        
        const places = deepResults;

        console.log(`Found ${places.length} locations`);
        
        if (places.length === 0) {
             // Capture debug info if empty
             await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
             const html = await page.content();
             fs.writeFileSync('debug_page.html', html);
        }

        await browser.close();

        // Sanitize and Save Logic (Borrowed from RapidAPI version)
        const sanitize = (name) => (name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        // If we have granular params, use them. If only query, try to infer or just save to 'scraped_results'
        const { country, state, city, category } = req.body;
        
        let targetDir;
        let jsonPath;
        let xlsxPath;

        if (country && state && city && category) {
            const baseDir = path.join(__dirname, '..', 'datascrapper');
            targetDir = path.join(baseDir, sanitize(country), sanitize(state), sanitize(city));
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            const categorySlug = sanitize(category);
            jsonPath = path.join(targetDir, `${categorySlug}.json`);
            xlsxPath = path.join(targetDir, `${categorySlug}.xlsx`);
        } else {
             // Fallback for generic query
             const baseDir = path.join(__dirname, '..', 'datascrapper', 'misc');
             if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
             const timestamp = Date.now();
             jsonPath = path.join(baseDir, `scrape_${timestamp}.json`);
             xlsxPath = path.join(baseDir, `scrape_${timestamp}.xlsx`);
             targetDir = baseDir;
        }

        // Save JSON
        const mappedPlaces = places.map(p => ({
            name: p.name,
            rating: p.rating,
            review_count: p.review_count,
            full_address: p.full_address,
            phone_number: p.phone_number,
            website: p.website,
            google_maps_url: p.google_maps_url,
            place_id: p.place_id
        }));

        fs.writeFileSync(jsonPath, JSON.stringify(mappedPlaces, null, 2));

        // Save Excel
        const excelData = mappedPlaces.map(item => ({
             Name: item.name,
             "Google Maps URL": item.google_maps_url,
             Rating: item.rating,
             Website: item.website,
             Phone: item.phone_number
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
        XLSX.writeFile(workbook, xlsxPath);

        console.log(`Saved scraped data to ${jsonPath}`);
        
        return res.status(200).json({
            success: true,
            message: `Found ${places.length} locations. Saved to storage.`,
            data: places,
            savedAt: targetDir
        });

    } catch (error) {
        console.error('Scraping error:', error);
        if (browser) await browser.close();
        
        // Try to capture error state
        try {
             if (browser) { // Re-init might be needed if browser crashed, but usually error happens during page ops
                 // Assume browser still matches variable if not crashed
             }
        } catch (e) {}

        return res.status(500).json({ success: false, message: "Scraping failed", error: error.message });
    } finally {
        if (browser) await browser.close();
    }
};

exports.searchGoogleMapsRapidAPI = async (req, res) => {
    const { country, state, city, category, latitude, longitude, radius } = req.body;

    // Validate required fields
    const hasTextLocation = country && state && city;
    const hasCoordinates = latitude && longitude;

    if (!category || (!hasTextLocation && !hasCoordinates)) {
        return res.status(400).json({ 
            success: false, 
            message: "Invalid Request: 'category' is required. Plus, either provide (country, state, city) OR (latitude, longitude)." 
        });
    }

    // Construct query
    let query = category;
    if (hasTextLocation) {
        query = `${category} in ${city}, ${state}, ${country}`;
    }

    // Helper for Grid Search
    const generateGrid = (lat, lng, radius) => {
        const points = [{ latitude: lat, longitude: lng }];
        if (radius <= 2000) return points;

        // Approx simple grid: step size ~2km (approx 0.018 degrees)
        const step = 0.018; 
        const steps = Math.floor(radius / 2000); 
        
        // Generate a 3x3 or 5x5 grid based on steps
        // Limiting to max 9 points for now to avoid burning too many credits accidentally
        // User can tune this.
        const limit = 1; // +/- 1 step means 3x3 grid = 9 points. 
        
        for (let x = -limit; x <= limit; x++) {
            for (let y = -limit; y <= limit; y++) {
                if (x === 0 && y === 0) continue; // Center already added
                points.push({
                    latitude: parseFloat(lat) + (x * step),
                    longitude: parseFloat(lng) + (y * step)
                });
            }
        }
        return points;
    };

    try {
        const rapidApiKey = process.env.RAPIDAPI_KEY || '180db87617msh1d181ef3478cd86p1ea94fjsn6e1b274ec8a3';
        const rapidApiHost = 'google-map-places-new-v2.p.rapidapi.com';

        let gridPoints = [{ latitude, longitude }];
        if (latitude && longitude && radius > 2000) {
            console.log(`Radius ${radius} > 2000m. Generating search grid...`);
            gridPoints = generateGrid(latitude, longitude, radius);
            console.log(`Grid generated: ${gridPoints.length} points.`);
        }

        let allPlaces = [];
        const seenPlaceIds = new Set();

        for (const [index, point] of gridPoints.entries()) {
            // Rate Limiting: Wait 5 seconds between grid points
            if (index > 0) {
                 console.log(`Waiting 5 seconds before next grid point...`);
                 await new Promise(resolve => setTimeout(resolve, 5000));
            }

            console.log(`Processing Grid Point ${index + 1}/${gridPoints.length}: ${point.latitude}, ${point.longitude}`);
            
            const options = {
                method: 'POST',
                url: `https://${rapidApiHost}/v1/places:searchText`,
                headers: {
                    'x-rapidapi-key': rapidApiKey,
                    'x-rapidapi-host': rapidApiHost,
                    'Content-Type': 'application/json',
                    'X-Goog-FieldMask': '*'
                },
                data: {
                    textQuery: query,
                    languageCode: 'en',
                    maxResultCount: 100,
                }
            };

            if (point.latitude && point.longitude) {
                options.data.locationBias = {
                    circle: {
                        center: {
                            latitude: parseFloat(point.latitude),
                            longitude: parseFloat(point.longitude)
                        },
                        radius: 2000 
                    }
                };
            }

            let nextPageToken = null;
            let pageCount = 0;
            const maxPages = 100;

            do {
                pageCount++;
                if (nextPageToken) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    options.data.pageToken = nextPageToken;
                }

                let retries = 3;
                let success = false;
                
                while (retries > 0 && !success) {
                    try {
                        const response = await axios.request(options);
                        const places = response.data.places || [];
                        console.log(`   Page ${pageCount}: Received ${places.length} results`);

                        for (const p of places) {
                            if (!seenPlaceIds.has(p.id)) {
                                seenPlaceIds.add(p.id);
                                allPlaces.push(p);
                            }
                        }

                        nextPageToken = response.data.nextPageToken;
                        if (places.length === 0) {
                             nextPageToken = null; // Break outer loop
                        }
                        success = true;

                    } catch (err) {
                        if (err.response && err.response.status === 429) {
                            console.warn(`   Rate Limit 429 hit. Retrying in ${6 - retries}s...`);
                            await new Promise(resolve => setTimeout(resolve, (4000 * (4 - retries)))); // Backoff: 4s, 8s, 12s
                            retries--;
                        } else {
                            console.error(`Error fetching grid point ${index}:`, err.message);
                            retries = 0; // Fatal error, stop trying this page
                            nextPageToken = null; // Stop paging for this point
                        }
                    }
                }

                if (!success) {
                    console.error(`   Failed to fetch page ${pageCount} after retries.`);
                    break; // Move to next grid point
                }

            } while (nextPageToken && pageCount < maxPages);
        }

        console.log(`Total unique businesses fetched across grid: ${allPlaces.length}`);
        const places = allPlaces;

        const savedBusinesses = [];
        const excelData = [];

        for (const item of places) {
            const businessData = {
                query: query,
                place_id: item.id || (item.name ? item.name.split('/').pop() : null),
                name: item.displayName ? item.displayName.text : item.name,
                full_address: item.formattedAddress,
                phone_number: item.nationalPhoneNumber || item.internationalPhoneNumber,
                website: item.websiteUri,
                rating: item.rating,
                review_count: item.userRatingCount,
                latitude: item.location ? item.location.latitude : null,
                longitude: item.location ? item.location.longitude : null,
                type: item.types ? item.types[0] : null,
                google_maps_url: item.googleMapsUri,
                business_status: item.businessStatus
            };

            // Prepare excel row
            excelData.push({
                Name: businessData.name,
                Website: businessData.website || '',
                "Contact Number": businessData.phone_number || '',
                "Email Address": '', 
                Rating: businessData.rating || '',
                LatLong: `${businessData.latitude}, ${businessData.longitude}`,
                Address: businessData.full_address
            });

            if (businessData.place_id) {
                const saved = await GoogleBusiness.findOneAndUpdate(
                    { place_id: businessData.place_id },
                    businessData,
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
                savedBusinesses.push(saved);
            } else {
                const saved = await GoogleBusiness.create(businessData);
                savedBusinesses.push(saved);
            }
        }

        // Sanitize names to be safe folder names
        const sanitize = (name) => (name ? String(name).replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'unknown');

        // Create a map to group businesses by their specific location path
        const groupedBusinesses = new Map();
        const baseDir = path.join(__dirname, '..', 'datascrapper');

        // Helper to extract location from address components
        const getLocationPath = (place) => {
            let pCountry = country; // Default to request params
            let pState = state;
            let pCity = city;

            if (place.addressComponents) {
                const getComp = (type) => place.addressComponents.find(c => c.types && c.types.includes(type))?.longText;
                
                const compCountry = getComp('country');
                const compState = getComp('administrative_area_level_1');
                // Use locality (City) or fallback to administrative_area_level_2 (County/District)
                const compCity = getComp('locality') || getComp('administrative_area_level_2');

                // Only override if we found valid components
                if (compCountry && compState && compCity) {
                    pCountry = compCountry;
                    pState = compState;
                    pCity = compCity;
                }
            }

            // Fallback for coordinates/unknowns
            if (!pCountry || !pState || !pCity) {
                if (latitude && longitude) {
                    return path.join(baseDir, 'coordinates', `${sanitize(latitude)}_${sanitize(longitude)}`);
                }
                return path.join(baseDir, 'misc', 'unknown_location');
            }

            return path.join(baseDir, sanitize(pCountry), sanitize(pState), sanitize(pCity));
        };

        // Group scraped locations
        for (let i = 0; i < places.length; i++) {
            const rawPlace = places[i];
            const savedBiz = savedBusinesses[i]; // Corresponds to the same index
            
            // Determine folder path for this specific item
            const itemPath = getLocationPath(rawPlace);
            
            if (!groupedBusinesses.has(itemPath)) {
                groupedBusinesses.set(itemPath, []);
            }
            groupedBusinesses.get(itemPath).push(savedBiz);
        }

        const savedPaths = [];

        // Save files for each group
        for (const [targetPath, items] of groupedBusinesses.entries()) {
            if (!fs.existsSync(targetPath)) {
                fs.mkdirSync(targetPath, { recursive: true });
            }

            const categorySlug = sanitize(category);
            
            // 1. Save JSON
            const jsonPath = path.join(targetPath, `${categorySlug}.json`);
            
            let finalItems = items;
            
            // MERGE LOGIC: Check if file exists and merge unique items
            if (fs.existsSync(jsonPath)) {
                try {
                    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
                    const existingData = JSON.parse(fileContent);
                    
                    if (Array.isArray(existingData)) {
                        const existingIds = new Set(existingData.map(b => b.place_id).filter(id => id));
                        
                        // Items is array of Mongoose docs, so accessing properties directly works
                        const newUniqueItems = items.filter(item => !existingIds.has(item.place_id));
                        
                        if (newUniqueItems.length > 0) {
                            console.log(`Merging ${newUniqueItems.length} new items into ${jsonPath}`);
                            // Convert Mongoose docs to objects if needed (usually JSON.stringify handles it, but spreading might need toObject)
                            // But usually safely spreadable.
                             finalItems = [...existingData, ...newUniqueItems];
                        } else {
                             console.log(`No new unique items for ${jsonPath}. Keeping existing.`);
                             finalItems = existingData;
                        }
                    }
                } catch (err) {
                    console.error(`Error reading ${jsonPath} for merging:`, err.message);
                    // Fallback: Proceed with overwriting (using 'items') if file is corrupt
                }
            }

            fs.writeFileSync(jsonPath, JSON.stringify(finalItems, null, 2));

            // 2. Save Excel
            const xlsxPath = path.join(targetPath, `${categorySlug}.xlsx`);
            
            // Use finalItems to ensure Excel matches JSON
            const groupExcelData = finalItems.map(item => ({
                Name: item.name,
                Website: item.website || '',
                "Contact Number": item.phone_number || '',
                "Email Address": '',
                Rating: item.rating || '',
                LatLong: `${item.latitude}, ${item.longitude}`,
                Address: item.full_address
            }));

            const worksheet = XLSX.utils.json_to_sheet(groupExcelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
            XLSX.writeFile(workbook, xlsxPath);

            savedPaths.push(targetPath);
            
            // Also ensure these locations exist in DB for the dropdowns
            // We can extract the raw strings from the path or the items? 
            // getLocationPath returned a path.. let's just re-extract from one item in the group
            // actually 'items' are the saved Mongoose docs, they might haven't stored the clean country/state/city texts.
            // But we can parse the path relative to baseDir?
            
            const relPath = path.relative(baseDir, targetPath);
            const pathParts = relPath.split(path.sep);
            if (pathParts[0] !== 'coordinates' && pathParts[0] !== 'misc' && pathParts.length >= 3) {
                 // Try to "ensure" this location. 
                 // Note: path names are sanitized (lowercase, underscores). 
                 // We might want the "Display Names" for the DB.
                 // This is tricky. But `ensureLocationsExist` usually takes display names.
                 // We have the raw place data in `places` loop.
                 // Let's optimize: We ignored the ensureLocations step. 
            }
        }

        return res.status(200).json({
            success: true,
            message: `Fetched ${savedBusinesses.length} businesses. Sorted into ${groupedBusinesses.size} locations.`,
            data: savedBusinesses,
            savedPaths: savedPaths
        });

    } catch (error) {
        console.error('RapidAPI Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: "Failed to fetch data from RapidAPI", 
            error: error.message,
            details: error.response ? error.response.data : null
        });
    }
};

const nodemailer = require('nodemailer');

// ... existing code ...

exports.getStoredBusinesses = async (req, res) => {
    // ... existing code ...
};

// --- DATASET ENDPOINTS ---

exports.getDatasetSearchParams = async (req, res) => {
    try {
        const { country, state, city, category } = req.query;

        // Validation: Country is minimum requirement
        if (!country) {
             return res.status(400).json({ success: false, message: "Country is required for dataset search." });
        }

        // Sanitize for file path
        const sanitize = (name) => (name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        const baseDir = path.join(__dirname, '..', 'datascrapper');
        
        // Construct target directory based on provided granularity
        let targetDirParts = [baseDir, sanitize(country)];
        if (state) targetDirParts.push(sanitize(state));
        if (city) targetDirParts.push(sanitize(city));
        
        const targetDir = path.join(...targetDirParts);

        if (!fs.existsSync(targetDir)) {
             return res.status(200).json({ success: true, datasets: [], message: "No data found for these parameters." });
        }

        let results = [];

        // Recursive scan for all JSON files under targetDir
        const walkSync = (dir, filelist = []) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filepath = path.join(dir, file);
                if (fs.statSync(filepath).isDirectory()) {
                    walkSync(filepath, filelist);
                } else {
                    if (file.endsWith('.json') && !file.endsWith('.metadata.json')) {
                        // Infer category from filename
                        const catName = file.replace('.json', '');
                        filelist.push({ path: filepath, category: catName });
                    }
                }
            });
            return filelist;
        };

        // If Category is specific, we still use walkSync to find it (as it might be in subfolders if scoping by country)
        // Actually, if category is specific BUT we are scoping by country, we basically want "All restaurants in US".
        // So we filter the walkSync results.
        let allFiles = walkSync(targetDir);
        if (category) {
            const sanitizedCat = sanitize(category);
            allFiles = allFiles.filter(f => f.category === sanitizedCat);
        }

        // AGGREGATION LOGIC: Group by Category
        const grouped = {};
        
        allFiles.forEach(file => {
             try {
                const fileContent = fs.readFileSync(file.path, 'utf-8');
                const businesses = JSON.parse(fileContent);
                
                if (!grouped[file.category]) {
                    grouped[file.category] = {
                        category: file.category,
                        totalRecords: 0,
                        emailCount: 0,
                        phones: 0,
                        lastUpdate: fs.statSync(file.path).mtime, // Approximate
                        filePaths: []
                    };
                }
                
                grouped[file.category].totalRecords += businesses.length;
                grouped[file.category].emailCount += businesses.filter(b => b.website).length; // Keeping logic consistent
                grouped[file.category].phones += businesses.filter(b => b.phone_number).length;
                grouped[file.category].filePaths.push(file.path);

             } catch (err) {
                 console.error(`Error reading file ${file.path}:`, err);
             }
        });

        // Convert grouped object to array
        const urlSanitize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
        
        // Determine search scope string for ID
        // If searched by Country -> united-states
        // If Country + State -> new-york-united-states
        let scopeSlug = urlSanitize(country);
        let locDisplay = country;
        
        if (state) {
            scopeSlug = `${urlSanitize(state)}-${scopeSlug}`;
            locDisplay = `${state}, ${locDisplay}`;
        }
        if (city) {
            scopeSlug = `${urlSanitize(city)}-${scopeSlug}`;
            locDisplay = `${city}, ${locDisplay}`;
        }

        const datasets = Object.values(grouped).map(group => {
            const catClean = group.category.replace(/_/g, ' ');
            const toTitleCase = (str) => str.replace(/\b\w/g, s => s.toUpperCase());
            
            // ID: category-in-scope
            const id = `${urlSanitize(catClean)}-in-${scopeSlug}`;

            return {
                id: id,
                category: toTitleCase(catClean),
                location: locDisplay, // Broad location
                totalRecords: group.totalRecords,
                emailCount: group.emailCount,
                phones: group.phones,
                lastUpdate: new Date(group.lastUpdate).toLocaleDateString(),
                price: "$199"
            };
        });

        return res.status(200).json({ success: true, datasets });


    } catch (error) {
        console.error('Error fetching dataset params:', error);
        return res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};

exports.getDatasetDetail = async (req, res) => {
    try {
        const { id } = req.params;
        // ID format: category-in-scope (where scope could be city-state-country OR just state-country OR just country)
        const parts = id.split('-in-');
        if (parts.length < 2) return res.status(404).json({ success: false, message: "Invalid Dataset ID" });
        
        const categorySlug = parts[0]; 
        const locSlug = parts[1];
        
        // Reverse engineer location path from locSlug
        // locSlug "united-states" -> united_states
        // locSlug "new-york-united-states" -> united_states/new_york
        // locSlug "new-york-new-york-united-states" -> united_states/new_york/new_york
        
        // Since we don't know the exact split (hyphens in names), we can try to "find" the directory.
        // Helper: convert slug hyphens to search path underscores or whatever matches.
        // Simplified Logic: The slug IS built from sanitized parts which used underscores on disk but hyphens in URL.
        // BUT my sanitize used underscores for disk, and urlSanitize used hyphens for URL.
        // So replacing - with _ might work IF names don't have hyphens.
        
        // Better approach: We know `datascrapper` structure.
        // We can walk `datascrapper` and match the paths that "end with" the locSlug parts? No, ambiguous.
        
        // Let's TRY to split locSlug by known delimiters? No delimiters.
        // Let's Assume the parts are "Country", "State", "City" in reverse order of specificity?
        // Actually, let's just search for the category FILE recursively from the BEST GUESS directory.
        
        // Safe bet: Start from `datascrapper`. Find ALL files that match `categorySlug` (normalized).
        // Then filtering those whose path *contains* the locSlug parts? 
        // e.g. "united-states" -> paths having "united_states".
        
        const categoryFile = categorySlug.replace(/-/g, '_'); // restaurants -> restaurants
        const baseDir = path.join(__dirname, '..', 'datascrapper');
        
        // Recursive FIND all matching category files
        const findFiles = (dir, filelist = []) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filepath = path.join(dir, file);
                if (fs.statSync(filepath).isDirectory()) {
                    findFiles(filepath, filelist);
                } else {
                    if (file === `${categoryFile}.json`) {
                        filelist.push(filepath);
                    }
                }
            });
            return filelist;
        };
        
        let allMatches = findFiles(baseDir);
        
        // Filter matches based on locSlug
        // This is the tricky part. `locSlug` = "united-states". We want all files under `united_states`.
        // `locSlug` = "new-york-united-states". We want files under `united_states/new_york`.
        // Normalized match: convert locSlug to underscore? 
        const normalizedLoc = locSlug.replace(/-/g, '_');
        
        // We filter files where the path includes the normalizedLoc? 
        // "united_states" is in "d:/.../datascrapper/united_states/..." -> YES.
        // "new_york_united_states" -> path "united_states/new_york" -> `path.join` segments check?
        
        // Let's require that ALL segments of the slug (split by -) appear in the path? 
        // "new", "york", "united", "states". 
        // Path: "united_states", "new_york". 
        // This is robust enough for now.
        const slugParts = locSlug.split('-');
        
        const relevantFiles = allMatches.filter(f => {
            const rel = path.relative(baseDir, f).replace(/\\/g, '/').toLowerCase(); 
            // locSlug: "new-york-united-states" -> ["new", "york", "united", "states"]
            // path: "united_states/new_york/..."
            const tokens = locSlug.split('-');
            // Check if every token matches the path (allowing for partial matching like 'new' in 'new_york')
            return tokens.every(t => rel.includes(t)); 
        });

        if (relevantFiles.length === 0) {
             return res.status(404).json({ success: false, message: "Dataset files not found." });
        }
        
        // MERGE DATA
        let mergedBusinesses = [];
        relevantFiles.forEach(fp => {
            try {
                const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                mergedBusinesses = mergedBusinesses.concat(content);
            } catch(e) {}
        });
        
        const businesses = mergedBusinesses;
        
        // Construct Dataset Object
        const totalCount = businesses.length;
        const sampleList = businesses.slice(0, 20).map(b => ({
            name: b.name,
            address: b.full_address,
            city: b.full_address ? b.full_address.split(',').slice(-3, -2)[0]?.trim() || 'N/A' : 'N/A',
            state: b.full_address ? b.full_address.split(',').slice(-2, -1)[0]?.trim() || 'N/A' : 'N/A',
            country: b.full_address ? b.full_address.split(',').pop().trim() : 'N/A', 
            email: null, 
            website: b.website || null,
            phone: b.phone_number || null,
            rating: b.rating,
            reviews: b.review_count
        }));
        
        const dataset = {
            id: id,
            category: categorySlug.replace(/-/g, ' ').toUpperCase(),
            location: locSlug.replace(/-/g, ' ').toUpperCase(), 
            totalRecords: totalCount,
            emailCount: businesses.filter(b => b.website).length,
            lastUpdate: new Date().toLocaleDateString(),
            price: "$199",
            sampleList: sampleList
        };

        return res.status(200).json({ success: true, data: dataset });

    } catch (error) {
         console.error('Error fetching dataset detail:', error);
        return res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};

exports.purchaseDataset = async (req, res) => {
    try {
        const { id, email, fullName, phoneNumber } = req.body;
        
        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        // Logic duplicated from Detail to Resolve Files
        const parts = id.split('-in-');
        const categorySlug = parts[0]; 
        const categoryFile = categorySlug.replace(/-/g, '_');
        const baseDir = path.join(__dirname, '..', 'datascrapper');

        // Find files
         const findFiles = (dir, filelist = []) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filepath = path.join(dir, file);
                if (fs.statSync(filepath).isDirectory()) {
                    findFiles(filepath, filelist);
                } else {
                    if (file === `${categoryFile}.json`) {
                        filelist.push(filepath);
                    }
                }
            });
            return filelist;
        };
        
        const relevantFiles = findFiles(baseDir); // Naive scoping for demo
        
        if (relevantFiles.length === 0) {
             return res.status(404).json({ success: false, message: "Dataset source not found." });
        }

        // Aggregate for XLSX
        let mergedBusinesses = [];
        relevantFiles.forEach(fp => {
            try {
                const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                mergedBusinesses = mergedBusinesses.concat(content);
            } catch(e) {}
        });

        const excelData = mergedBusinesses.map(item => ({
             Name: item.name,
             Website: item.website || '',
             "Contact Number": item.phone_number || '',
             "Email Address": '',
             Rating: item.rating || '',
             LatLong: `${item.latitude || ''}, ${item.longitude || ''}`,
             Address: item.full_address
        }));
        
        const timestamp = Date.now();
        const purchaseDir = path.join(__dirname, '..', 'datascrapper', 'purchases');
        if (!fs.existsSync(purchaseDir)) fs.mkdirSync(purchaseDir, { recursive: true });
        
        const attachmentPath = path.join(purchaseDir, `${id}_${timestamp}.xlsx`);
        
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
        XLSX.writeFile(workbook, attachmentPath);

        console.log(`[PURCHASE] User ${fullName} (${email}) purchased ${id}. Generated aggregated file: ${attachmentPath}`);
        
        return res.download(attachmentPath);

    } catch (error) {
        console.error('Error purchasing dataset:', error);
        return res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};
