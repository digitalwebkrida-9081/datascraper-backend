const Country = require('../models/Country');
const State = require('../models/State');
const City = require('../models/City');
const { Country: CountryLib, State: StateLib, City: CityLib } = require('country-state-city');

/**
 * Ensures that the Country, State, and City exist in the database.
 * If not, it creates them.
 * @param {string} countryName 
 * @param {string} stateName 
 * @param {string} cityName 
 * @param {object} coordinates { latitude, longitude }
 */
exports.ensureLocationsExist = async (countryName, stateName, cityName, coordinates = {}) => {
    try {
        if (!countryName) return;

        // 1. Country
        let countryCode = null;
        // Try to find in Library first for ISO code
        const libCountry = CountryLib.getAllCountries().find(c => c.name.toLowerCase() === countryName.toLowerCase());
        countryCode = libCountry ? libCountry.isoCode : countryName.substring(0, 2).toUpperCase();
        
        // Upsert Country
        await Country.findOneAndUpdate(
            { name: new RegExp(`^${countryName}$`, 'i') },
            { 
                name: countryName, 
                isoCode: countryCode, // fallback if not found
                flag: libCountry ? libCountry.flag : '🏳️' 
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (!stateName) return;

        // 2. State
        let stateCode = null;
        // Try to find in Library
        if (countryCode && libCountry) {
             const libState = StateLib.getStatesOfCountry(countryCode).find(s => s.name.toLowerCase() === stateName.toLowerCase());
             stateCode = libState ? libState.isoCode : stateName.substring(0, 2).toUpperCase();
        } else {
             stateCode = stateName.substring(0, 2).toUpperCase();
        }

        await State.findOneAndUpdate(
            { name: new RegExp(`^${stateName}$`, 'i'), countryCode: countryCode },
            {
                name: stateName,
                isoCode: stateCode,
                countryCode: countryCode,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (!cityName) return;

        // 3. City
        await City.findOneAndUpdate(
             { name: new RegExp(`^${cityName}$`, 'i'), stateCode: stateCode, countryCode: countryCode },
             {
                 name: cityName,
                 stateCode: stateCode,
                 countryCode: countryCode,
                 latitude: coordinates.latitude,
                 longitude: coordinates.longitude
             },
             { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`Ensured locations exist: ${countryName} > ${stateName} > ${cityName}`);

    } catch (error) {
        console.error('Error ensuring locations exist:', error);
    }
};
