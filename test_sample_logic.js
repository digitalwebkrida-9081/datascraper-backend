const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const SAMPLE_MASK_MESSAGE = "Included in purchased data";

function processSampleRow(row, strict = true) {
    const isPlaceholder = (val) => {
        if (!val) return true;
        const lower = val.toString().toLowerCase().trim();
        return (
            lower === '' ||
            lower === '--' ||
            lower === 'n/a' ||
            lower === 'null' ||
            lower === 'unknown' ||
            lower.includes('available in full list') ||
            lower.includes('available in purchased data') ||
            (lower.includes('available') && lower.includes('list')) ||
            (lower.includes('available') && lower.includes('verified'))
        );
    };

    const name = row.name || row.Name || row.Business_Name || row.business_name || '';
    if (isPlaceholder(name)) return null;

    const phone = row.phone || row.Phone || row.phone_number || row.contact_number || '';
    const website = row.website || row.Website || row.url || '';
    const address = row.address || row.Address || row.full_address || '';

    const realPhone = !isPlaceholder(phone);
    const realWebsite = !isPlaceholder(website);
    const realAddress = !isPlaceholder(address);

    if (strict && !realPhone && !realWebsite) return null;

    const processed = { ...row };

    Object.keys(processed).forEach(key => {
        if (isPlaceholder(processed[key])) {
            processed[key] = ''; 
        }
    });

    if (!processed.Name) processed.Name = name;
    if (!processed.Address) processed.Address = address;
    if (!processed.Phone) processed.Phone = phone;
    if (!processed.Website) processed.Website = website;

    const emailKeys = Object.keys(processed).filter(key => key.toLowerCase().includes('email'));
    emailKeys.forEach(key => {
        if (processed[key] || (row[key] && row[key].toString().toLowerCase().includes('available'))) {
            processed[key] = SAMPLE_MASK_MESSAGE;
        }
    });

    return processed;
}

// Mock Test
const mockData = [
    { Name: "High Quality 1", Phone: "123", Website: "google.com", Email: "test@test.com" },
    { Name: "High Quality 2", Phone: "456", Website: "yahoo.com", Email: "test2@test.com" },
    { Name: "Decent 1", Phone: "available in list", Website: "", Email: "hidden@test.com" },
    { Name: "Decent 2", Phone: "", Website: "N/A", Email: "" },
    { Name: "Placeholder", Phone: "N/A", Website: "--", Email: "available" },
    { Name: "", Phone: "123", Website: "web.com", Email: "bad@test.com" }
];

async function runTest() {
    const rows = [];
    const decentRows = [];
    const limit = 3;

    mockData.forEach(row => {
        const hq = processSampleRow(row, true);
        if (hq) rows.push(hq);
        else {
            const decent = processSampleRow(row, false);
            if (decent) decentRows.push(decent);
        }
    });

    if (rows.length < limit) {
        rows.push(...decentRows.slice(0, limit - rows.length));
    }

    console.log("Resulting Rows:");
    console.log(JSON.stringify(rows, null, 2));

    const allMasked = rows.every(r => !r.Email || r.Email === SAMPLE_MASK_MESSAGE);
    console.log("All emails masked:", allMasked);
    console.log("Count correct:", rows.length <= limit);
}

runTest();
