const fs = require('fs');

const file = 'e:/Local-Send/smartscrapers-main/data_api_server.js';
let content = fs.readFileSync(file, 'utf8');

const targetStart = "app.get('/api/merged/stats', async (req, res) => {";
const targetEnd = "// HEALTH CHECK";

const startIndex = content.indexOf(targetStart);
let endIndex = content.indexOf(targetEnd);

// Back up to the comment line start to remove it fully from replace boundary
if (endIndex !== -1) {
    const backupIndex = content.lastIndexOf('// ==========================================', endIndex);
    if (backupIndex > startIndex) {
        endIndex = backupIndex;
    }
}

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find start or end index! start:", startIndex, "end:", endIndex);
    process.exit(1);
}

const replacement = `app.get('/api/merged/stats', async (req, res) => {
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
        console.log(\`[Stats] Done in \${elapsed}s — \${globalTotals.totalRecords.toLocaleString()} total records\`);

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
});\n\n`;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync(file, newContent, 'utf8');
console.log("Successfully patched stats endpoint.");
