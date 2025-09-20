const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require('qrcode-terminal');
const { getTempData, setTempData, getAllKeys } = require("./src/services/tempStoreService.js");
const { getCompanyData } = require("./src/services/googleSheetsService.js");
const mongoose = require("mongoose");
const { MongoStore } = require('wwebjs-mongo');
const dotenv = require("dotenv");
const { initRedis } = require('./src/config/redisClient.js');

dotenv.config();
initRedis();
console.log('Redis client is connected and ready. ✅');

// Helper functions
function normalizePhoneNumber(phoneNumber) {
    // Remove all non-digit characters and ensure it starts with country code
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // If it starts with 0, assume it's a local number and add 234 (Nigeria)
    if (cleaned.startsWith('0')) {
        cleaned = '234' + cleaned.substring(1);
    }
    
    // Ensure it has a country code (if it's 10 digits, assume Nigeria)
    if (cleaned.length === 10) {
        cleaned = '234' + cleaned;
    }
    
    return cleaned;
}

function createSessionKey(sessionId) {
    return `session_${sessionId}`;
}

function createPhoneSessionKey(phoneNumber) {
    return `phone_session_${phoneNumber}`;
}

async function findSessionByPhoneAndTime(phoneNumber, maxAgeMinutes = 10) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    console.log(`Looking for session for phone: ${normalizedPhone}`);
    
    try {
        // Get all session keys
        const allKeys = await getAllKeys('session_*');
        console.log(`Found ${allKeys.length} total sessions to check`);
        
        const currentTime = Date.now();
        const maxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds
        
        for (const key of allKeys) {
            try {
                const sessionData = await getTempData(key);
                if (sessionData) {
                    // Handle both string and object responses from getTempData
                    const data = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
                    const sessionAge = currentTime - data.timestamp;
                    
                    console.log(`Checking session ${data.sessionId}, age: ${Math.floor(sessionAge / 60000)} minutes`);
                    
                    // Check if session is within time window
                    if (sessionAge <= maxAge) {
                        console.log(`Found valid session within time window: ${data.sessionId}`);
                        
                        // Check if this phone number hasn't been used yet
                        const phoneSessionKey = createPhoneSessionKey(normalizedPhone);
                        const existingPhoneSession = await getTempData(phoneSessionKey);
                        
                        if (!existingPhoneSession) {
                            // Claim this session for this phone number
                            await setTempData(phoneSessionKey, data.sessionId, 600); // 10 minute expiry
                            console.log(`Claimed session ${data.sessionId} for phone ${normalizedPhone}`);
                            return data;
                        } else if (existingPhoneSession === data.sessionId) {
                            // This phone already claimed this session
                            console.log(`Phone ${normalizedPhone} already claimed session ${data.sessionId}`);
                            return data;
                        }
                    }
                }
            } catch (parseError) {
                console.error(`Error parsing session data for key ${key}:`, parseError);
            }
        }
        
        console.log(`No valid session found for phone ${normalizedPhone}`);
        return null;
    } catch (error) {
        console.error('Error finding session by phone and time:', error);
        return null;
    }
}

async function extractSessionFromMessage(msg) {
    // First try temporal + phone correlation
    const phoneNumber = msg.from.replace('@c.us', ''); // Remove WhatsApp suffix
    console.log(`Message from phone: ${phoneNumber}`);
    
    const sessionData = await findSessionByPhoneAndTime(phoneNumber);
    if (sessionData) {
        console.log(`Found session via phone correlation: ${sessionData.sessionId}`);
        return sessionData;
    }
    
    // Fallback: try to extract UUID directly from message (for backward compatibility)
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const match = msg.body.match(uuidRegex);
    if (match) {
        const sessionId = match[0];
        console.log(`Found session via direct UUID extraction: ${sessionId}`);
        
        // Try to get session data
        const sessionDataStr = await getTempData(createSessionKey(sessionId));
        if (sessionDataStr) {
            // Handle both string and object responses from getTempData
            return typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
        }
    }
    
    return null;
}

mongoose.connect(process.env.MONGODB_URI)
.then(() => {
    const store = new MongoStore({ mongoose: mongoose });
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000,
        }),
    });

    client.on("qr", (qr) => {
        console.log("Please scan the QR code to log in:");
        qrcode.generate(qr, { small: true });
    });

    client.on("authenticated", () => {
        console.log("Authentication successful!");
    });

    client.on("auth_failure", (msg) => {
        console.error("Authentication failure:", msg);
    });

    client.on("ready", () => {
        console.log("WhatsApp bot client is ready!");
    });

    client.on('message', async (msg) => {
        console.log('Message received:', msg.body);
        console.log('From:', msg.from);
        
        if (msg.body === '!ping') {
            msg.reply('pong');
            return;
        }

        // Use the improved session extraction with phone correlation
        const sessionData = await extractSessionFromMessage(msg);

        if (sessionData) {
            console.log(`Processing session: ${sessionData.sessionId} for company: ${sessionData.companyId}`);

            const { companyId, imageUrl } = sessionData;
            const companyData = await getCompanyData(companyId);

            if (!companyData) {
                console.error(`Company data not found for ID: ${companyId}`);
                msg.reply('I am sorry, I cannot find the details for this company. Please try again later.');
                return;
            }

            const botResponse = `📍 *${companyData.COMPANY}*\n\n` +
                `💰 *Service Rates*\n` +
                `• ${companyData['RATE & SERVICES  ( I )']}\n` +
                `• ${companyData['RATE & SERVICES  ( II )']}\n` +
                `• ${companyData['RATE & SERVICES  ( III )']}\n` +
                `• ${companyData['RATE & SERVICES  ( IV )']}\n\n` +
                `👨‍✈️ *Owner / Driver*\n` +
                `${companyData['OWNER / DRIVER']}\n\n` +
                `🗣️ *Languages*\n` +
                `${companyData['LANGUAGES - A']}, ${companyData['LANGUAGES - B'].trim()}\n\n` +
                `🚗 *Vehicle Model & Licensed*\n` +
                `${companyData['VEHICLE MODEL']}\n` +
                `✅ Licensed: ${companyData.LICENSED}\n\n` +
                `🗺️ *Coverage Area*\n` +
                `${companyData.COVERAGE}\n\n` +
                `🧰 *Services*\n` +
                `${companyData.SERVICES}\n\n` +
                `📆 *Availability*\n` +
                `${companyData['AVAILABILITY ']}\n\n` +
                `☎️ *Contact Method*\n` +
                `${companyData['CONTACT METHOD']}\n\n` +
                `${companyData['THANK YOU MESSAGE']}`;

            const bridgeMsg = companyData['BRIDGE MESSAGE']?.trim();

            if (imageUrl) {
                try {
                    // Use a dynamic import here to load node-fetch
                    const fetch = (await import('node-fetch')).default; 
                    const response = await fetch(imageUrl);
                    if (!response.ok) throw new Error('Failed to fetch image');
                    const buffer = await response.buffer();
                    const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `${companyData.COMPANY}.jpg`);
                    await msg.reply(media);
                } catch (error) {
                    console.error(`Error sending image for ${imageUrl}:`, error);
                }
            }

            if (bridgeMsg) {
                await msg.reply(bridgeMsg);
                setTimeout(async () => {
                    await msg.reply(botResponse);
                }, 30000);
            } else {
                await msg.reply(botResponse);
            }
        } else {
            console.log('No valid session found for this message.');
            // Send a helpful message for users without valid sessions
            msg.reply('Hello! It looks like your inquiry link may have expired. Please generate a new chat link from our website to get personalized moving service details.');
        }
    });

    client.initialize();
})
.catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
});

// const qrcode = require('qrcode-terminal');
// const { getTempData } = require("./src/services/tempStoreService.js");
// const { getCompanyData } = require("./src/services/googleSheetsService.js");
// const mongoose = require("mongoose");
// const { MongoStore } = require('wwebjs-mongo');
// const dotenv = require("dotenv");
// const { initRedis } = require('./src/config/redisClient.js');


// dotenv.config();
//         initRedis();
//         console.log('Redis client is connected and ready. ✅');

// mongoose.connect(process.env.MONGODB_URI)
// .then(() => {
//     const store = new MongoStore({ mongoose: mongoose });
//     const client = new Client({
//         authStrategy: new RemoteAuth({
//             store: store,
//             backupSyncIntervalMs: 300000,
//         }),
//     });

//     client.on("qr", (qr) => {
//         console.log("Please scan the QR code to log in:");
//         qrcode.generate(qr, { small: true });
//     });

//     client.on("authenticated", () => {
//         console.log("Authentication successful!");
//     });

//     client.on("auth_failure", (msg) => {
//         console.error("Authentication failure:", msg);
//     });

//     client.on("ready", () => {
//         console.log("WhatsApp bot client is ready!");
//     });

//     client.on('message', async (msg) => {
//         console.log('Message received:', msg.body);
//         if (msg.body === '!ping') {
//             msg.reply('pong');
//             return;
//         }
    
//         const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
//         const match = msg.body.match(uuidRegex);
    
//         if (match) {
//             const sessionId = match[0];
//             console.log(`Extracted session ID: ${sessionId}`);
    
//             const tempData = await getTempData(sessionId);
//             if (!tempData || !tempData.companyId) {
//                 console.log(`Session ID ${sessionId} not found or expired.`);
//                 msg.reply('Sorry, your request has expired or is invalid. Please generate a new chat link.');
//                 return;
//             }
    
//             const { companyId, imageUrl } = tempData;
//             const companyData = await getCompanyData(companyId);
    
//             if (!companyData) {
//                 console.error(`Company data not found for ID: ${companyId}`);
//                 msg.reply('I am sorry, I cannot find the details for this company. Please try again later.');
//                 return;
//             }
    
           
//             const botResponse = `📍 *${companyData.COMPANY}*\n\n` +
//                 `💰 *Service Rates*\n` +
//                 `• ${companyData['RATE & SERVICES  ( I )']}\n` +
//                 `• ${companyData['RATE & SERVICES  ( II )']}\n` +
//                 `• ${companyData['RATE & SERVICES  ( III )']}\n` +
//                 `• ${companyData['RATE & SERVICES  ( IV )']}\n\n` +
//                 `👨‍✈️ *Owner / Driver*\n` +
//                 `${companyData['OWNER / DRIVER']}\n\n` +
//                 `🗣️ *Languages*\n` +
//                 `${companyData['LANGUAGES - A']}, ${companyData['LANGUAGES - B'].trim()}\n\n` +
//                 `🚗 *Vehicle Model & Licensed*\n` +
//                 `${companyData['VEHICLE MODEL']}\n` +
//                 `✅ Licensed: ${companyData.LICENSED}\n\n` +
//                 `🗺️ *Coverage Area*\n` +
//                 `${companyData.COVERAGE}\n\n` +
//                 `🧰 *Services*\n` +
//                 `${companyData.SERVICES}\n\n` +
//                 `📆 *Availability*\n` +
//                 `${companyData['AVAILABILITY ']}\n\n` +
//                 `☎️ *Contact Method*\n` +
//                 `${companyData['CONTACT METHOD']}\n\n` +
//                 `${companyData['THANK YOU MESSAGE']}`;
    
//             const bridgeMsg = companyData['BRIDGE MESSAGE']?.trim();
    
//             if (imageUrl) {
//                 try {
//                     // Use a dynamic import here to load node-fetch
//                     const fetch = (await import('node-fetch')).default; 
//                     const response = await fetch(imageUrl);
//                     if (!response.ok) throw new Error('Failed to fetch image');
//                     const buffer = await response.buffer();
//                     const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `${companyData.COMPANY}.jpg`);
//                     await msg.reply(media);
//                 } catch (error) {
//                     console.error(`Error sending image for ${imageUrl}:`, error);
//                 }
//             }
    
//             if (bridgeMsg) {
//                 await msg.reply(bridgeMsg);
//                 setTimeout(async () => {
//                     await msg.reply(botResponse);
//                 }, 30000);
//             } else {
//                 await msg.reply(botResponse);
//             }
//         } else {
//             console.log('Message did not contain a valid session ID.');
//         }
//     });

//     client.initialize();
// })
// .catch(err => {
//     console.error("MongoDB connection error:", err);
//     process.exit(1);
// });
