const express = require('express');
const router = express.Router();
const FormSubmission = require('../models/FormSubmission');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// @route   POST /api/forms/submit
// @desc    Submit form data
// @access  Public
router.post('/submit', async (req, res) => {
    try {
        const { type, name, email, phone, message, datasetDetails } = req.body;

        if (!type || !email) {
            return errorResponse(res, 'Type and Email are required', 400);
        }

        const newSubmission = new FormSubmission({
            type,
            name,
            email,
            phone,
            message,
            datasetDetails
        });

        await newSubmission.save();

        return successResponse(res, newSubmission, 'Form submitted successfully');
    } catch (error) {
        console.error('Error submitting form:', error);
        return errorResponse(res, 'Internal Server Error', 500, error.message);
    }
});

// @route   GET /api/forms/all
// @desc    Get all form submissions (Admin)
// @access  Public (Should be protected in production)
router.get('/all', async (req, res) => {
    try {
        const submissions = await FormSubmission.find().sort({ createdAt: -1 });
        return successResponse(res, submissions, 'Submissions retrieved successfully');
    } catch (error) {
        console.error('Error fetching submissions:', error);
        return errorResponse(res, 'Internal Server Error', 500, error.message);
    }
});

// @route   DELETE /api/forms/:id
// @desc    Delete a form submission
// @access  Public (Should be protected)
router.delete('/:id', async (req, res) => {
    try {
        const submission = await FormSubmission.findById(req.params.id);

        if (!submission) {
            return errorResponse(res, 'Submission not found', 404);
        }

        await FormSubmission.findByIdAndDelete(req.params.id);

        return successResponse(res, null, 'Submission deleted successfully');
    } catch (error) {
        console.error('Error deleting submission:', error);
        return errorResponse(res, 'Internal Server Error', 500, error.message);
    }
});

module.exports = router;
