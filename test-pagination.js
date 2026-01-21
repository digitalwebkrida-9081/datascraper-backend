const axios = require('axios');

async function testPagination() {
    const rapidApiKey = '180db87617msh1d181ef3478cd86p1ea94fjsn6e1b274ec8a3';
    const rapidApiHost = 'google-map-places-new-v2.p.rapidapi.com';

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
            textQuery: 'Gyms in New York, NY',
            languageCode: 'en',
            maxResultCount: 20
        }
    };

    try {
        console.log('Sending request...');
        const response = await axios.request(options);
        console.log('Response Status:', response.status);
        console.log('Places count:', response.data.places ? response.data.places.length : 0);
        console.log('Next Page Token:', response.data.nextPageToken || 'Not Found');
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

testPagination();
