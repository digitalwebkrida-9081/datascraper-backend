const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripeController');

// We use express.raw for the webhook so Stripe can verify the payload signature
router.post('/webhook', express.raw({ type: 'application/json' }), stripeController.webhook);

// Use express.json() explicitly for these routes since the global parser comes after them in app.js
router.post('/create-checkout-session', express.json(), stripeController.createCheckoutSession);

router.post('/verify-session-and-download', express.json(), stripeController.verifySessionAndDownload);

module.exports = router;
