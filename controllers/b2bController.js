const B2BLead = require('../models/B2BLead');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Get all B2B Leads with Filters
exports.getAllLeads = async (req, res) => {
    try {
        const { country, city, state, category } = req.query;
        let filter = {};

        // Filter by Category
        if (category) {
            filter.category = { $regex: category, $options: 'i' };
        }

        // Filter by Location (Country, City, State) across the single 'location' field
        // We accumulate location terms to ensure the record matches all provided location parts
        const locationTerms = [country, city, state].filter(Boolean);
        if (locationTerms.length > 0) {
            const locationConditions = locationTerms.map(term => ({
                $or: [
                    { location: { $regex: term, $options: 'i' } },
                    { "sampleList.country": { $regex: term, $options: 'i' } },
                    { "sampleList.city": { $regex: term, $options: 'i' } },
                    { "sampleList.state": { $regex: term, $options: 'i' } },
                    { "sampleList.address": { $regex: term, $options: 'i' } }
                ]
            }));
            
            if (filter.$and) {
                filter.$and.push(...locationConditions);
            } else {
                filter.$and = locationConditions;
            }
        }

        const leads = await B2BLead.find(filter).sort({ createdAt: -1 });
        // If empty, we can return empty array or successResponse
        successResponse(res, leads, 'B2B Leads fetched successfully');
    } catch (error) {
        errorResponse(res, 'Failed to fetch B2B leads', 500, error.message);
    }
};

// Get single Lead by ID
exports.getLeadById = async (req, res) => {
    try {
        const { id } = req.params;
        const lead = await B2BLead.findById(id);
        
        if (!lead) {
            return errorResponse(res, 'Lead not found', 404);
        }

        successResponse(res, lead, 'Lead details fetched successfully');
    } catch (error) {
        errorResponse(res, 'Failed to fetch lead details', 500, error.message);
    }
};

// Optional: Create Lead (for testing/seeding)
exports.createLead = async (req, res) => {
    try {
        const newLead = new B2BLead(req.body);
        const savedLead = await newLead.save();
        successResponse(res, savedLead, 'Lead created successfully');
    } catch (error) {
        errorResponse(res, 'Failed to create lead', 500, error.message);
    }
};

