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
    let cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '234' + cleaned.substring(1);
    }
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
        const allKeys = await getAllKeys('session_*');
        console.log(`Found ${allKeys.length} total sessions to check`);

        const currentTime = Date.now();
        const maxAge = maxAgeMinutes * 60 * 1000;

        for (const key of allKeys) {
            try {
                const sessionData = await getTempData(key);
                if (sessionData) {
                    const data = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
                    const sessionAge = currentTime - data.timestamp;

                    if (sessionAge <= maxAge) {
                        const phoneSessionKey = createPhoneSessionKey(normalizedPhone);
                        const existingPhoneSession = await getTempData(phoneSessionKey);

                        if (!existingPhoneSession) {
                            await setTempData(phoneSessionKey, data.sessionId, 600);
                            return data;
                        } else if (existingPhoneSession === data.sessionId) {
                            return data;
                        }
                    }
                }
            } catch (parseError) {
                console.error(`Error parsing session data for key ${key}:`, parseError);
            }
        }
        return null;
    } catch (error) {
        console.error('Error finding session by phone and time:', error);
        return null;
    }
}

async function extractSessionFromMessage(msg) {
    const phoneNumber = msg.from.replace('@c.us', '');
    const sessionData = await findSessionByPhoneAndTime(phoneNumber);
    if (sessionData) return sessionData;

    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const match = msg.body.match(uuidRegex);
    if (match) {
        const sessionId = match[0];
        const sessionDataStr = await getTempData(createSessionKey(sessionId));
        if (sessionDataStr) {
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
            if (msg.body === '!ping') {
                msg.reply('pong');
                return;
            }

            const sessionData = await extractSessionFromMessage(msg);

            if (sessionData) {
                const { companyId, imageUrl } = sessionData;
                const companyData = await getCompanyData(companyId);

                if (!companyData) {
                    msg.reply('I am sorry, I cannot find the details for this company. Please try again later.');
                    return;
                }

                const bridgeMsg = companyData['BRIDGE MESSAGE']?.trim();

                const formattedBridgeMsg = bridgeMsg
                    .replace(/MSF!/i, '*MSF!*')
                    .replace(/Company Name:/i, '*Company Name:*')
                    .replace(/Services Offered:/i, '*Services Offered:*')
                    .replace(/Cost:/i, '*Cost:*')
                    .replace(/Service Area:/i, '*Service Area:*')
                    .replace(/Note:/i, '*Note:*')
                    .replace(/How to Find Them/i, '*How to Find Them*')
                    .replace(/Search their name on Google/i, '• Search their name on *Google*')
                    .replace(/look them up on Facebook/i, 'look them up on *Facebook*')
                    .replace(/!/g, '\n')
                    .replace(/;/g, '\n');

                // CASE 1: Minimal data (only ID + BRIDGE MESSAGE)
                if (bridgeMsg && !companyData['COMPANY']) {
                    if (imageUrl) {
                        try {
                            const fetch = (await import('node-fetch')).default;
                            const response = await fetch(imageUrl);
                            const buffer = await response.buffer();
                            const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `company-${companyId}.jpg`);
                            await msg.reply(media, null, { caption: formattedBridgeMsg });
                        } catch (error) {
                            console.error(`Error sending bridge image:`, error);
                            await msg.reply(formattedBridgeMsg);
                        }
                    } else {
                        await msg.reply(formattedBridgeMsg);
                    }
                    return;
                }

                // CASE 2: Full data → send bridge + botResponse
                if (bridgeMsg) {
                    if (imageUrl) {
                        try {
                            const fetch = (await import('node-fetch')).default;
                            const response = await fetch(imageUrl);
                            const buffer = await response.buffer();
                            const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `${companyData.COMPANY}.jpg`);
                            await msg.reply(media, null, { caption: formattedBridgeMsg });
                        } catch (error) {
                            console.error(`Error sending bridge image:`, error);
                            await msg.reply(formattedBridgeMsg);
                        }
                    } else {
                        await msg.reply(formattedBridgeMsg);
                    }
                }

                // Build structured bot response
                const botResponse = `📍 *${companyData.COMPANY}*\n\n` +
                    `💰 *Service Rates*\n` +
                    `• ${companyData['RATE & SERVICES  ( I )']}\n` +
                    `• ${companyData['RATE & SERVICES  ( II )']}\n` +
                    `• ${companyData['RATE & SERVICES  ( III )']}\n` +
                    `• ${companyData['RATE & SERVICES  ( IV )']}\n\n` +
                    `👨‍✈️ *Owner / Driver*\n` +
                    `${companyData['OWNER / DRIVER']}\n\n` +
                    `🗣️ *Languages*\n` +
                    `${companyData['LANGUAGES - A']}, ${companyData['LANGUAGES - B']?.trim()}\n\n` +
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

                setTimeout(async () => {
                    if (companyData['COMPANY IMAGE']) {
                        try {
                            const fetch = (await import('node-fetch')).default;
                            const response = await fetch(companyData['COMPANY IMAGE']);
                            const buffer = await response.buffer();
                            const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `${companyData.COMPANY}.jpg`);
                            await msg.reply(media, null, { caption: botResponse });
                        } catch (error) {
                            console.error(`Error sending company image:`, error);
                            await msg.reply(botResponse);
                        }
                    } else {
                        await msg.reply(botResponse);
                    }
                }, 30000);
            } else {
                msg.reply('Hello! It looks like your inquiry link may have expired. Please generate a new chat link from our website to get personalized moving service details.');
            }
        });

        client.initialize();
    })
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });
