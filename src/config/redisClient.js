const { createClient } = require('redis');
const dotenv = require('dotenv');


dotenv.config();

const redisClient = createClient({
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
  }
});


//upstash commectiom
// const redisClient = createClient({
//   url: process.env.REDIS_URL,
//   // token: process.env.UPSTASH_REDIS_REST_TOKEN,
// });

redisClient.on('connect', () => {
    console.log('Redis client connecting...');
});

redisClient.on('error', err => console.error('Redis Client Error', err));

// ✅ export an init function (instead of calling it automatically)
 const initRedis = async () => {
    try {
        redisClient.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });

        await redisClient.connect();
        console.log('Connected to Redis');
    } catch (err) {
        console.error('Failed to connect to Redis:', err);
        process.exit(1); // Exit the process if the connection fails
    }
};

module.exports = { redisClient, initRedis };
// export { redisClient, initRedis };