const Stripe = require('stripe');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const FormSubmission = require('../models/FormSubmission');

// Optional: you can test with standard price for now
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-01-27'
});

exports.createCheckoutSession = async (req, res) => {
    try {
        const { id, email, fullName, phoneNumber, datasetName, price, successUrl, cancelUrl } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        // Form Submission as 'purchase_attempt' matching what PayPal did
        const parts = (id || '').split('-in-');
        const categorySlug = parts[0] || 'Dataset';
        
        await FormSubmission.create({
            type: 'purchase_attempt',
            name: fullName,
            email: email,
            phone: phoneNumber,
            datasetDetails: {
                id: id,
                category: categorySlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                price: price || 199,
            }
        });

        const session = await stripe.checkout.sessions.create({
            automatic_payment_methods: { enabled: true },
            customer_email: email,
            client_reference_id: id,
            allow_promotion_codes: true,
            metadata: {
                fullName,
                phoneNumber,
                datasetId: id,
            },
            line_items: [
                {
                    price_data: {
                        currency: 'usd', // or preferred currency
                        product_data: {
                            name: datasetName || `Dataset: ${id}`,
                            description: `Full data export for ${id}`,
                        },
                        unit_amount: Math.round((price || 199) * 100), // Stripe expects cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}&dataset_id=${id}`,
            cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout/cancel?dataset_id=${id}`,
        });

        res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('Stripe Checkout Error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};

exports.webhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        if (!endpointSecret) {
            console.warn('Stripe Webhook Secret not set. Skipping signature verification.');
            event = JSON.parse(req.body.toString());
        } else {
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        }
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        const customerEmail = session.customer_email;
        const metadata = session.metadata;
        const datasetId = metadata.datasetId || session.client_reference_id;
        
        console.log(`[STRIPE WEBHOOK] Successful payment from ${customerEmail} for ${datasetId}`);

        try {
            // Record the purchase in FormSubmissions (similar to PayPal flow)
            await FormSubmission.create({
                type: 'purchase_attempt',
                name: metadata.fullName || 'Unknown',
                email: customerEmail,
                phone: metadata.phoneNumber || 'Unknown',
                datasetDetails: {
                    id: datasetId,
                    amount_total: session.amount_total / 100, // convert back to dollars
                    currency: session.currency
                }
            });

            // Note: In B2bDatasetDetail, the file was generated and sent right back in the response
            // through a Blob. With Stripe checkout, we'll let the user download it from the success page.
            // When the user hits the success page, we could have an endpoint here /api/stripe/verify-session
            // to fetch the session and return the file.
        } catch (dbErr) {
            console.error('Error logging successful purchase to DB:', dbErr);
        }
    }

    res.status(200).json({ received: true });
};

// New endpoint to verify session and generate/return file directly
exports.verifySessionAndDownload = async (req, res) => {
    try {
        const { session_id, dataset_id } = req.body;
        if (!session_id || !dataset_id) {
            return res.status(400).json({ success: false, message: 'Missing session_id or dataset_id' });
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status !== 'paid') {
            return res.status(400).json({ success: false, message: 'Payment not successful' });
        }

        // Logic duplicated from purchaseDataset to Resolve Files
        const id = dataset_id;
        const parts = id.split('-in-');
        const categorySlug = parts[0]; 
        const locSlug = parts[1] || '';
        const categoryFile = categorySlug.replace(/-/g, '_');
        const baseDir = path.join(__dirname, '..', 'datascrapper');

        const findFiles = (dir, filelist = []) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filepath = path.join(dir, file);
                if (fs.statSync(filepath).isDirectory()) {
                    findFiles(filepath, filelist);
                } else {
                    if (file === `${categoryFile}.json`) {
                        filelist.push(filepath);
                    }
                }
            });
            return filelist;
        };
        
        let allMatches = findFiles(baseDir);
        let relevantFiles = allMatches;
        
        if (locSlug) {
            const tokens = locSlug.split('-');
            relevantFiles = allMatches.filter(f => {
                const rel = path.relative(baseDir, f).replace(/\\/g, '/').toLowerCase(); 
                return tokens.every(t => rel.includes(t)); 
            });
        }
        
        if (relevantFiles.length === 0) {
             return res.status(404).json({ success: false, message: "Dataset source not found." });
        }

        // Aggregate for XLSX
        let mergedBusinesses = [];
        relevantFiles.forEach(fp => {
            try {
                const relPath = path.relative(baseDir, fp).replace(/\\/g, '/');
                const pathParts = relPath.split('/');
                let expectedCity = null;
                if (pathParts[0] !== 'misc' && pathParts[0] !== 'coordinates' && pathParts.length >= 4) {
                    expectedCity = pathParts[2].replace(/_/g, ' ').toLowerCase();
                }

                const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                
                let filteredContent = content;
                if (expectedCity) {
                    filteredContent = content.filter(item => {
                        if (!item.full_address) return true;
                        const lowerAddress = item.full_address.toLowerCase();
                        const parts = item.full_address.split(',');
                        if (parts.length >= 3) {
                            const actualCity = parts[parts.length - 3].trim().toLowerCase();
                            if (actualCity.includes(expectedCity) || expectedCity.includes(actualCity)) return true;
                        }
                        return lowerAddress.includes(expectedCity);
                    });
                }
                
                mergedBusinesses = mergedBusinesses.concat(filteredContent);
            } catch(e) {}
        });

        const excelData = mergedBusinesses.map(item => ({
             Name: item.name,
             Website: item.website || '',
             "Contact Number": item.phone_number || '',
             "Email Address": '',
             Rating: item.rating || '',
             LatLong: `${item.latitude || ''}, ${item.longitude || ''}`,
             Address: item.full_address
        }));
        
        const timestamp = Date.now();
        const purchaseDir = path.join(__dirname, '..', 'datascrapper', 'purchases');
        if (!fs.existsSync(purchaseDir)) fs.mkdirSync(purchaseDir, { recursive: true });
        
        const attachmentPath = path.join(purchaseDir, `${id}_${session_id}.xlsx`);
        
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
        XLSX.writeFile(workbook, attachmentPath);

        console.log(`[STRIPE DOWNLOAD] File generated for session ${session_id}`);

        // Set headers to trigger a download on the frontend
        res.download(attachmentPath, `${id}.xlsx`, (err) => {
            if (err) {
                console.error("Error downloading file:", err);
            }
        });

    } catch (error) {
        console.error('Verify session error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
