const { Country, State, City: CityLibrary } = require('country-state-city');
const StateModel = require('../models/State');
const CityModel = require('../models/City');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Import States and Cities for IN and US
exports.importLocations = async (req, res) => {
    try {
        const targetCountries = ['IN', 'US'];
        let totalSImported = 0;
        let totalCImported = 0;

        for (const countryCode of targetCountries) {
            // 1. Get States
            const states = State.getStatesOfCountry(countryCode);
            let sImported = 0;
            let cImported = 0;

            for (const state of states) {
                // Save State
                await StateModel.findOneAndUpdate(
                    { isoCode: state.isoCode, countryCode: countryCode },
                    {
                        name: state.name,
                        isoCode: state.isoCode,
                        countryCode: state.countryCode,
                        latitude: state.latitude,
                        longitude: state.longitude
                    },
                    { upsert: true, new: true }
                );
                sImported++;

                // 2. Get Cities for this State
                const cities = CityLibrary.getCitiesOfState(countryCode, state.isoCode);

                for (const city of cities) {
                    // Save City
                    await CityModel.findOneAndUpdate(
                        { name: city.name, stateCode: state.isoCode, countryCode: countryCode },
                        {
                            name: city.name,
                            stateCode: state.isoCode,
                            countryCode: city.countryCode,
                            latitude: city.latitude,
                            longitude: city.longitude
                        },
                        { upsert: true }
                    );
                    cImported++;
                }
            }
            totalSImported += sImported;
            totalCImported += cImported;
            console.log(`Imported ${sImported} states and ${cImported} cities for ${countryCode}`);
        }

        successResponse(res, {
            statesImported: totalSImported,
            citiesImported: totalCImported
        }, `Location import completed for ${targetCountries.join(', ')}`);

    } catch (error) {
        console.error('Error importing locations:', error);
        errorResponse(res, 'Failed to import locations', 500, error.message);
    }
};

// Get States
// Get States
exports.getStates = async (req, res) => {
    try {
        let { country } = req.query;
        let countryCode = 'IN'; // Default to IN if nothing provided

        if (country) {
            // Check if input is a name like "United States" or code like "US"
            if (country.length === 2) {
                countryCode = country.toUpperCase();
            } else {
                // Try to find ISO code by name
                const allCountries = Country.getAllCountries();
                const found = allCountries.find(c => c.name.toLowerCase() === country.toLowerCase());
                if (found) {
                    countryCode = found.isoCode;
                }
            }
        }
        
        // Debug
        console.log(`Fetching states for Country Code: ${countryCode} (Input: ${country})`);

        // 1. Fetch from Library
        const libStates = State.getStatesOfCountry(countryCode) || [];

        // 2. Fetch from DB
        const dbStates = await StateModel.find({ countryCode: countryCode });

        // 3. Merge (DB overrides Library if duplicates found by name, though unlikely)
        // Actually, we just want to ensure we have all unique states.
        const mergedMap = new Map();
        
        libStates.forEach(s => mergedMap.set(s.isoCode, s));
        dbStates.forEach(s => {
            // DB states might use custom ISO codes or names
            mergedMap.set(s.isoCode, s);
        });

        const states = Array.from(mergedMap.values());
        
        successResponse(res, states, 'States fetched successfully');
    } catch (error) {
        errorResponse(res, 'Failed to fetch states', 500, error.message);
    }
};

// Get Cities by State Code
exports.getCities = async (req, res) => {
    try {
        const { stateCode } = req.params;
        const { country } = req.query; 
        
        // Determine Country Code
        let countryCode = 'IN'; 
        if (country) {
             if (country.length === 2) {
                 countryCode = country.toUpperCase();
             } else {
                 const allCountries = Country.getAllCountries();
                 const found = allCountries.find(c => c.name.toLowerCase() === country.toLowerCase());
                 if (found) countryCode = found.isoCode;
             }
        }

        // 1. Fetch from Library
        const libCities = CityLibrary.getCitiesOfState(countryCode, stateCode) || [];

        // 2. Fetch from DB
        const dbCities = await CityModel.find({ countryCode: countryCode, stateCode: stateCode });

        // 3. Merge
        const mergedMap = new Map();
        libCities.forEach(c => mergedMap.set(c.name.toLowerCase(), c));
        dbCities.forEach(c => mergedMap.set(c.name.toLowerCase(), c));

        const cities = Array.from(mergedMap.values());
        
        successResponse(res, cities, 'Cities fetched successfully');
    } catch (error) {
        errorResponse(res, 'Failed to fetch cities', 500, error.message);
    }
};
