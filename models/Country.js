const mongoose = require('mongoose');

const countrySchema = new mongoose.Schema({
    // We'll use a flexible strict: false schema to store whatever the API returns initially
    // Since we don't know the exact structure of the external API response yet.
    // However, usually country APIs return name, id, iso codes etc.
    name: {
        type: String,
        // required: true 
    },
    code: {
        type: String,
    },
    // Store the complete raw object from the API just in case
    rawData: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true,
    strict: false // Allow other fields to be saved
});

module.exports = mongoose.model('Country', countrySchema);
