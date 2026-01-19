const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    stateCode: {
        type: String,
        required: true,
        trim: true
    },
    countryCode: {
        type: String,
        required: true,
        trim: true
    },
    latitude: {
        type: String,
        trim: true
    },
    longitude: {
        type: String,
        trim: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('City', citySchema);
