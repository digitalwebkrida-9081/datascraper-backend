const express = require('express');
const router = express.Router();
const b2bController = require('../controllers/b2bController');


// Get All Leads
router.get('/', b2bController.getAllLeads);

// Get Single Lead
router.get('/:id', b2bController.getLeadById);

// Create Lead (Optional, for seeding)
router.post('/', b2bController.createLead);

module.exports = router;
