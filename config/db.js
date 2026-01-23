const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const mongoURI =   "mongodb://admin:Qwerty%23786@15.235.224.91:27017/world777-white-label?authSource=admin";
        await mongoose.connect(mongoURI);
        console.log('MongoDB Connected Successfully');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        process.exit(1);
    }
};

module.exports = connectDB;
