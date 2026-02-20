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

// @route   GET /api/forms/unread-count
// @desc    Get count of unread forms
// @access  Public (Should be protected)
router.get('/unread-count', async (req, res) => {
    try {
        const count = await FormSubmission.countDocuments({ isRead: false });
        return successResponse(res, { count }, 'Unread count retrieved');
    } catch (error) {
        console.error('Error fetching unread count:', error);
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

// @route   PUT /api/forms/:id/status
// @desc    Update a lead's status
// @access  Public (Should be protected)
router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['new', 'contacted', 'converted', 'closed'];
        
        if (!validStatuses.includes(status)) {
            return errorResponse(res, 'Invalid status value', 400);
        }

        const submission = await FormSubmission.findByIdAndUpdate(
            req.params.id,
            { status, isRead: true },
            { new: true }
        );

        if (!submission) {
            return errorResponse(res, 'Submission not found', 404);
        }

        return successResponse(res, submission, 'Status updated successfully');
    } catch (error) {
        console.error('Error updating status:', error);
        return errorResponse(res, 'Internal Server Error', 500, error.message);
    }
});

// @route   PUT /api/forms/:id/note
// @desc    Update a lead's note
// @access  Public (Should be protected)
router.put('/:id/note', async (req, res) => {
    try {
        const { note } = req.body;
        
        const submission = await FormSubmission.findByIdAndUpdate(
            req.params.id,
            { note, isRead: true },
            { new: true }
        );

        if (!submission) {
            return errorResponse(res, 'Submission not found', 404);
        }

        return successResponse(res, submission, 'Note updated successfully');
    } catch (error) {
        console.error('Error updating note:', error);
        return errorResponse(res, 'Internal Server Error', 500, error.message);
    }
});

// @route   POST /api/forms/bulk-delete
// @desc    Delete multiple form submissions
// @access  Public (Should be protected)
router.post('/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return errorResponse(res, 'Array of IDs is required', 400);
        }

        const result = await FormSubmission.deleteMany({ _id: { $in: ids } });

        return successResponse(res, { deletedCount: result.deletedCount }, `${result.deletedCount} submissions deleted`);
    } catch (error) {
        console.error('Error bulk deleting:', error);
        return errorResponse(res, 'Internal Server Error', 500, error.message);
    }
});

module.exports = router;
