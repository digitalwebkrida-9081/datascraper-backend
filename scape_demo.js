const express = require('express');
const app = express();
const port = 8549;

app.get('/', async (req, res) => {
    try {
        // Dynamic import to handle potential ESM package usage in CommonJS environment
        const { scraper } = await import('google-maps-review-scraper');

        const searchQuery = "schools in ahmedabad";

        console.log(`Scraping reviews for: ${searchQuery}`);

        // Using the scraper module as requested
        const reviews = await scraper("https://www.google.com/maps/place/", {
            sort_type: "newest", // Defaulting to newest, user passed "sort_type" string literally in snippet but likely meant a valid type
            search_query: searchQuery,
            clean: false
        });
        console.log(reviews);
        // res.json({
        //     status: 'success',
        //     count: reviews.length,
        //     data: reviews
        // });
    } catch (error) {
        console.error("Scraping error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(port, () => {
    console.log(`Scraper demo server running at http://localhost:${port}`);
});
