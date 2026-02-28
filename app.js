const express = require('express');
const connectDB = require('./config/db');
const redisClient = require('./config/redisClient'); 
const authMiddleware = require('./middleware/auth');
const { successResponse, errorResponse } = require('./common/helper/responseHelper');

const app = express();

// Routes
const countryRoutes = require('./routes/country');
const categoryRoutes = require('./routes/category');
const locationRoutes = require('./routes/location');
const b2bRoutes = require('./routes/b2b_database');
const scraperRoutes = require('./routes/scraper'); 
const formRoutes = require('./routes/formSubmission');
const mergedRoutes = require('./routes/merged');
const userRoutes = require('./routes/users');
const paymentRoutes = require('./routes/paymentRoutes');
const User = require('./models/User');
const cors = require('cors'); 

// Middleware
app.use(cors({origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE']})); // Enable CORS for frontend access
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/country', countryRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/b2b-leads', b2bRoutes);
app.use('/api/scraper', scraperRoutes); // Mount scraper routes
app.use('/api/forms', formRoutes);
app.use('/api/users', userRoutes);
app.use('/api/merged', mergedRoutes);
app.use('/api/payment', paymentRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    // Custom errorResponse signature: (res, message, statusCode, error)
    errorResponse(res, 'Something broke!', 500, err);
});

const PORT = 6969;

// Connect to Database before listening
connectDB().then(async () => {
    // Seed default admin if no users exist
    try {
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            console.log('No users found. Seeding default admin user...');
            const defaultAdmin = new User({
                username: 'admin',
                password: process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'Dhavan@2911',
                role: 'admin'
            });
            await defaultAdmin.save();
            console.log('Default admin user created successfully.');
        }
    } catch (err) {
        console.error('Error checking/seeding users:', err);
    }

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to connect to Database', err);
    process.exit(1);
});
