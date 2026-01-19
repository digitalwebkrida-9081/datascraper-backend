const redis = require('redis');

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

// Connect immediately
(async () => {
    try {
        // await redisClient.connect();
        console.log('Redis connection skipped for B2B dev');
    } catch (err) {
        console.error('Failed to connect to Redis:', err);
    }
})();

module.exports = redisClient;
