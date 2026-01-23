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
const cors = require('cors'); 

// Middleware
app.use(cors()); // Enable CORS for frontend access
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/country', countryRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/b2b-leads', b2bRoutes);
app.use('/api/scraper', scraperRoutes); // Mount scraper routes

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    errorResponse(res, 'Something broke!', 500, err.message);
});

const PORT = 6969;

// Connect to Database before listening
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to connect to Database', err);
    process.exit(1);
});
