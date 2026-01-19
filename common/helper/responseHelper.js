const successResponse = (res, data, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data
    });
};

const errorResponse = (res, message = 'Internal Server Error', statusCode = 500, error = null) => {
    const response = {
        success: false,
        message
    };
    if (error) {
        response.error = error;
    }
    return res.status(statusCode).json(response);
};

module.exports = {
    successResponse,
    errorResponse
};
