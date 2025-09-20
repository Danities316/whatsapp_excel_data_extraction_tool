const express = require('express');
const dotenv = require('dotenv');
const { router: chatRoutes } = require('./src/api/chatRoutes.js');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { redisClient } = require('./src/config/redisClient.js');

dotenv.config();
const app = express();
const PORT = 8888;

// =================================================================
// Middleware Configuration
// =================================================================
app.use(express.json());
app.use(cors({ origin: '*' }));

// Middleware for rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    standardHeaders: true, 
    legacyHeaders: false, 
    message: 'Too many requests from this IP, please try again after 15 minutes.'
});

// =================================================================
// Route Configuration
// =================================================================
app.use('/api/', apiLimiter);
app.use('/api', chatRoutes);

// Simple root route for a health check
app.get('/', (req, res) => {
    res.status(200).send('WhatsApp Bot API is running!');
});

// =================================================================
// Error Handling Middleware
// =================================================================
app.use((err, req, res, next) => {
    console.error(err.stack); // Log the error stack trace
    res.status(500).send('Something broke!');
});

// Connect to Redis and then start the server
async function startServer() {
    try {
        await redisClient.connect(); // Await the connection
        console.log('Redis client is connected and ready. ✅');

        // Now start the server
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
            console.log('Press Ctrl+C to stop the server.');
        });
    } catch (err) {
        console.error('Failed to connect to Redis:', err);
        process.exit(1); // Exit if the connection fails
    }
}

// Start the whole application
startServer();