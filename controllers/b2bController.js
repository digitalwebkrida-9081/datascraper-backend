const B2BLead = require('../models/B2BLead');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Get all B2B Leads
exports.getAllLeads = async (req, res) => {
    try {
        const leads = await B2BLead.find().sort({ createdAt: -1 });
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
