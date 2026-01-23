const axios = require('axios');

async function testScraper() {
    try {
        console.log('Sending request to scraper...');
        const response = await axios.post('http://stagservice.datasellerhub.com/api/scraper/search', {
            query: 'barber shop in kodinar'
        });
        
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

testScraper();
