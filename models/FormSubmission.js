const mongoose = require('mongoose');

const formSubmissionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['sample_request', 'contact_form', 'purchase_attempt', 'custom_database'],
        required: true
    },
    name: {
        type: String,
        required: false // some forms might not have name
    },
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: false
    },
    message: {
        type: String,
        required: false
    },
    datasetDetails: {
        type: Object, // Store JSON details about the dataset they were interested in
        required: false
    },
    note: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: ['new', 'contacted', 'converted', 'closed'],
        default: 'new'
    },
    isRead: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('FormSubmission', formSubmissionSchema);
