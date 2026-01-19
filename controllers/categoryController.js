const axios = require('axios');
const Category = require('../models/Category');
const { successResponse, errorResponse } = require('../common/helper/responseHelper');

// Import categories from external API
exports.importCategories = async (req, res) => {
    try {
        const apiUrl = 'https://rentechdigital.com/_next/data/LV_kuszUB78NTE7Jw720V/smartscraper/business-reports/united-states.json?slug=united-states';

        const response = await axios.get(apiUrl);
        const categoriesData = response.data.pageProps.businessReportlist;

        if (!categoriesData || categoriesData.length === 0) {
            return errorResponse(res, 'No categories found in API response', 404);
        }

        let importedCount = 0;
        let updatedCount = 0;

        for (const cat of categoriesData) {
            const categoryData = {
                name: cat.categorie_name,
                slug: cat.slug,
                bannerTitle: cat.banner_title
            };

            const result = await Category.updateOne(
                { slug: cat.slug },
                { $set: categoryData },
                { upsert: true }
            );

            if (result.upsertedCount > 0) {
                importedCount++;
            } else if (result.modifiedCount > 0) {
                updatedCount++;
            }
        }

        successResponse(res, {
            imported: importedCount,
            updated: updatedCount,
            totalProcessed: categoriesData.length
        }, `Categories processing completed. Imported: ${importedCount}, Updated: ${updatedCount}`);

    } catch (error) {
        console.error('Error importing categories:', error);
        errorResponse(res, 'Failed to import categories', 500, error.message);
    }
};

// Get all categories
exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find().sort({ name: 1 });
        successResponse(res, categories, 'Categories fetched successfully');
    } catch (error) {
        console.error('Error fetching categories:', error);
        errorResponse(res, 'Failed to fetch categories', 500, error.message);
    }
};
