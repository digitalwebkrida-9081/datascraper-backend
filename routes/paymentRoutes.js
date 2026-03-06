const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// PayPal REST API routes
router.post('/create-paypal-order', paymentController.createOrder);
router.post('/capture-paypal-order', paymentController.captureOrder);

// Orders route
router.get('/orders', paymentController.getOrders);

module.exports = router;
