const axios = require('axios');
const Country = require('../models/Country');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Fetch from external API and store in DB (Upsert)
const addCountries = async (req, res) => {
    try {
        let data = '';

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://api.rentechdigital.com/smartscraper/business/get-countrys',
            headers: {},
            data: data
        };

        const response = await axios.request(config);
        const countriesData = response.data;

        let countriesList = [];

        // Normalize data structure
        if (Array.isArray(countriesData)) {
            countriesList = countriesData;
        } else if (countriesData.data && Array.isArray(countriesData.data)) {
            countriesList = countriesData.data;
        } else {
            countriesList = [countriesData];
        }

        if (countriesList.length > 0) {
            // Prepare Bulk Operations for Upsert
            const bulkOps = countriesList.map(country => {
                // Determine a unique identifier. 
                // Using 'name' if available, otherwise 'id' or fallback.
                const uniqueFilter = {};
                if (country.name) uniqueFilter.name = country.name;
                else if (country.id) uniqueFilter.id = country.id; // Assuming raw data might have an ID
                else uniqueFilter.rawData = country; // Risky fallback

                // If we have a decent filter, use it. Otherwise, assume duplicate check is impossible on this item.
                // We'll trust 'name' is the intended unique key for a Country.

                return {
                    updateOne: {
                        filter: uniqueFilter,
                        update: {
                            $set: {
                                ...country,
                                rawData: country
                            }
                        },
                        upsert: true
                    }
                };
            });

            const result = await Country.bulkWrite(bulkOps);

            return successResponse(res, {
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
                upsertedCount: result.upsertedCount,
                insertedCount: result.insertedCount
            }, 'Countries processed successfully');
        }

        return successResponse(res, null, 'No valid country data found to process', 200);

    } catch (error) {
        console.error('Error adding countries:', error);
        return errorResponse(res, 'Failed to add countries', 500, error.message);
    }
};

// Get countries from local DB
const getCountries = async (req, res) => {
    try {
        const countries = await Country.find({});
        successResponse(res, countries, 'Countries retrieved successfully');
    } catch (error) {
        console.error('Error fetching countries from DB:', error);
        errorResponse(res, 'Failed to retrieve countries', 500, error.message);
    }
};

module.exports = {
    addCountries,
    getCountries
};
