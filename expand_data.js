const fs = require('fs');
const path = require('path');

const filePath = String.raw`d:\Local-Send\smartscrapers-main\datascrapper\united_states\new_york\new_york\restaurants.json`;

try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Original count: ${data.length}`);

    let expandedData = [...data];
    
    
    for (let i = 1; i <= 4; i++) {
        const clone = data.map(item => ({
            ...item,
            _id: `${item._id}_copy_${i}`,
            place_id: `${item.place_id}_copy_${i}`,
            name: `${item.name} ${i+1}` 
        }));
        expandedData = expandedData.concat(clone);
    }

    console.log(`New count: ${expandedData.length}`);
    fs.writeFileSync(filePath, JSON.stringify(expandedData, null, 2));
    console.log('Successfully expanded dataset.');

} catch (err) {
    console.error('Error expanding data:', err);
}
