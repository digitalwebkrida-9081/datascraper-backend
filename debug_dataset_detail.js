const scraperController = require('./controllers/scraperController');
const path = require('path');
const fs = require('fs');

// Mock Request and Response
const req = {
    params: {
        id: 'jewelry-stores-in-halvad-gujarat-india'
    }
};

const res = {
    status: function(code) {
        this.statusCode = code;
        return this;
    },
    json: function(data) {
        console.log('Status:', this.statusCode);
        console.log('Data Price:', data.data ? data.data.price : 'No Data');
        console.log('Data Previous Price:', data.data ? data.data.previousPrice : 'No Data');
        if (data.data) {
            console.log('Full Data Keys:', Object.keys(data.data));
        }
    }
};

console.log('Testing getDatasetDetail...');
scraperController.getDatasetDetail(req, res);
