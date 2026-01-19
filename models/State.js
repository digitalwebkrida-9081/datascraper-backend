const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    isoCode: {
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

// Compound index to ensure unique states per country
stateSchema.index({ isoCode: 1, countryCode: 1 }, { unique: true });

module.exports = mongoose.model('State', stateSchema);
