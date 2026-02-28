const axios = require('axios');
const PaymentTransaction = require('../models/PaymentTransaction');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');
require('dotenv').config();

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENVIRONMENT } = process.env;
const base = PAYPAL_ENVIRONMENT === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

const generateAccessToken = async () => {
    try {
        if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
            throw new Error('MISSING_API_CREDENTIALS');
        }
        const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
        const response = await axios.post(`${base}/v1/oauth2/token`, 'grant_type=client_credentials', {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Failed to generate Access Token:', error);
        throw error;
    }
};

exports.createOrder = async (req, res) => {
    try {
        const { datasetDetails, price } = req.body;
        
        // We ensure a price string formats correctly
        let orderPrice = "199.00";
        if (price) {
            orderPrice = parseFloat(price).toFixed(2);
        } else if (datasetDetails && datasetDetails.price) {
            orderPrice = parseFloat(datasetDetails.price).toFixed(2);
        }

        const accessToken = await generateAccessToken();
        const url = `${base}/v2/checkout/orders`;
        const payload = {
            intent: 'CAPTURE',
            purchase_units: [
                {
                    amount: {
                        currency_code: 'USD',
                        value: orderPrice,
                    },
                    description: `Dataset: ${datasetDetails?.category || 'Any'} in ${datasetDetails?.location || 'Any'}`
                },
            ],
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        console.log('--- PAYPAL API RESPONSE ---');
        console.log(JSON.stringify(data, null, 2));

        if (!response.ok) {
            throw new Error(data.message || 'Failed to create order with PayPal');
        }

        res.status(200).json({ success: true, message: 'Order created successfully', data: data });
    } catch (error) {
        console.error('Failed to create order:', error?.response?.data || error);
        res.status(500).json({ success: false, message: 'Failed to create order', error: error?.response?.data || error.message });
    }
};

exports.captureOrder = async (req, res) => {
    try {
        const { orderID, name, email, phone, datasetDetails } = req.body;
        const accessToken = await generateAccessToken();
        const url = `${base}/v2/checkout/orders/${orderID}/capture`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            }
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to capture order with PayPal');
        }

        // Save to DB
        const transaction = new PaymentTransaction({
            orderId: orderID,
            name,
            email,
            phone,
            datasetDetails,
            amount: data?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0,
            status: data.status,
            rawResponse: data
        });
        await transaction.save();
        res.status(200).json({ success: true, message: 'Order captured successfully', data: data });
    } catch (error) {
        console.error('Failed to capture order:', error?.response?.data || error);
        res.status(500).json({ success: false, message: 'Failed to capture order', error: error?.response?.data || error.message });
    }
};
