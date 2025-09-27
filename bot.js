const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require('qrcode-terminal');
const { getTempData, setTempData, getAllKeys, markFallbackReplied, hasFallbackReplied, deleteTempData } = require("./src/services/tempStoreService.js");
const { getCompanyData } = require("./src/services/googleSheetsService.js");
const mongoose = require("mongoose");
const { MongoStore } = require('wwebjs-mongo');
const dotenv = require("dotenv");
const { initRedis, redisClient } = require('./src/config/redisClient.js');

dotenv.config();

const BOT_PHONE = process.env.BOT_PHONE || '';
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
          console.log("Parsed session data:", data);
          const sessionAge = currentTime - data.timestamp;

          if (sessionAge <= maxAge) {
            const phoneSessionKey = createPhoneSessionKey(normalizedPhone);
            console.log("phoneSessionKey:", phoneSessionKey);
            const existingPhoneSession = await getTempData(phoneSessionKey);
            console.log("Existing phone session:", existingPhoneSession);

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
    console.log(`No valid session found for phone: ${normalizedPhone}`);
    return null;
  } catch (error) {
    console.error('Error finding session by phone and time:', error);
    return null;
  }
}

async function extractSessionFromMessage(msg) {
  const phoneNumber = msg.from.replace('@c.us', '');
  const sessionData = await findSessionByPhoneAndTime(phoneNumber);
  console.log("Session data from phone lookup:", sessionData);
  if (sessionData) return sessionData;

  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  const match = msg.body.match(uuidRegex);
  if (match) {
    const sessionId = match[0];
    const sessionDataStr = await getTempData(createSessionKey(sessionId));
    console.error(`Session data found for ID ${sessionId}:`, sessionDataStr);
    if (sessionDataStr) {
      return typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
    }
  }

  console.log(`No session data found for phone ${match} or in message.`);
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

    client.on("qr", async (qr) => {
      console.error("New QR generated → Clearing old Redis sessions...");
      const keys = await getAllKeys('session_*');
      for (const key of keys) await redisClient.del(key);

      const phoneKeys = await getAllKeys('phone_session_*');
      for (const key of phoneKeys) await redisClient.del(key);

      qrcode.generate(qr, { small: true });
    });



    client.on("authenticated", () => {
      console.log("Authentication successful!");
    });

    client.on("auth_failure", async (msg) => {
      console.error("Authentication failure:", msg);
      console.error("Clearing Redis sessions...");

      const allKeys = [
        ...(await getAllKeys("session_*")),
        ...(await getAllKeys("phone_session_*"))
      ];
      for (const key of allKeys) await redisClient.del(key);
    });

    client.on("ready", () => {
      console.log("WhatsApp bot client is ready!");
    });

    client.on('message', async (msg) => {
      if (msg.body === '!ping') {
        msg.reply('pong');
        return;
      }

      const phoneNumber = msg.from.replace('@c.us', '');
      // console.log(`Incoming message from ${phoneNumber}: ${msg.body}`);

      const phoneSessionKey = `phone_session_${phoneNumber}`;

      // (handles string or object stored in phone_session)
      const extractSessionId = (raw) => {
        if (!raw) return null;
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'object' && raw.sessionId) return raw.sessionId;
        return null;
      };

      // 1) Load any existing phone->session mapping
      const rawPhoneSession = await getTempData(phoneSessionKey);
      const mappedSessionId = extractSessionId(rawPhoneSession);
      let sessionData = null;

      if (mappedSessionId) {
        sessionData = await getTempData(`session_${mappedSessionId}`);
        if (sessionData) {
          console.log(`Found existing session for ${phoneNumber}: ${mappedSessionId}`);
        }
        if (!sessionData || !sessionData.companyId) {
          console.warn(`Invalid or stale session data for ${phoneNumber}. Ignoring.`);
          return;
        }

        // If session is already in-progress or completed, bail out immediately
        // We consider 'bridge_sending' and 'bridge_sent' as in-progress states.
        if (sessionData.status === 'bridge_sending' || sessionData.status === 'bridge_sent' || sessionData.status === 'response_sent') {
          console.log(`Session ${sessionData.sessionId} already being processed for ${phoneNumber} (status=${sessionData.status}). Ignoring incoming message.`);
          return;
        }
        // Note: at this point sessionData.status might be 'pending' or 'active'
      }

      // 2) If no mapping or stale, find a pending session to claim
      if (!sessionData) {
        const allKeys = await getAllKeys('session_*');
        const now = Date.now();

        for (const key of allKeys) {
          const candidate = await getTempData(key);
          if (candidate && candidate.status === 'pending' && (now - candidate.timestamp) <= 10 * 60 * 1000) {
            // store phone->session mapping as plain sessionId string (avoid double-wrapping)
            await setTempData(phoneSessionKey, candidate.sessionId, 600);
            candidate.phone = phoneNumber;
            candidate.status = 'active';
            await setTempData(key, candidate, 600);

            sessionData = candidate;
            // console.log(`Claimed pending session ${candidate.sessionId} for ${phoneNumber}`);
            break;
          }
        }

        // 3) If still no session → fallback (but don't fallback if user already completed a flow)
        if (!sessionData) {
          if (await getTempData(`completed_user_${phoneNumber}`)) {
            console.log(`User ${phoneNumber} already completed flow, ignoring messages.`);
            return;
          }

          if (!(await hasFallbackReplied(phoneNumber))) {
            await markFallbackReplied(phoneNumber);
            await msg.reply(
              `This is the official contact line for www.movingservicefinland.com.\n` +
              `It looks like you're trying to inquire about our services.\n` +
              `Please visit our website to book, find, and compare prices.\n` +
              `Thanks for reaching out!`
            );
          }
          return;
        }
      }

      // Now we have a valid sessionData (status should be 'active' or 'pending')
      const sessionKey = `session_${sessionData.sessionId}`;
      const { companyId, imageUrl } = sessionData;
      const companyData = await getCompanyData(companyId);
      if (!companyData) {
        await msg.reply('I am sorry, I cannot find the details for this company. Please try again later.');
        return;
      }

      const bridgeMsg = companyData['BRIDGE MESSAGE']?.trim() || '';
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

      // -------------------------
      // IMPORTANT: mark "bridge_sending" BEFORE actually sending the bridge
      // this prevents concurrent handlers from executing the same flow
      // -------------------------
      try {
        sessionData.status = 'bridge_sending';
        await setTempData(sessionKey, sessionData, 600);
      } catch (err) {
        console.error('Failed to persist bridge_sending state, aborting to avoid dupes:', err);
        return;
      }

      // Send the bridge (text or image+caption)
      try {
        if (bridgeMsg) {
          if (imageUrl) {
            try {
              const fetch = (await import('node-fetch')).default;
              const response = await fetch(imageUrl);
              const buffer = await response.buffer();
              const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `company-${companyId}.jpg`);
              await msg.reply(media, null, { caption: formattedBridgeMsg });
            } catch (err) {
              console.error('Error fetching/sending bridge image, sending text instead:', err);
              await msg.reply(formattedBridgeMsg);
            }
          } else {
            await msg.reply(formattedBridgeMsg);
          }
        }
        // After successful send, mark bridge_sent and mark responseScheduled (persist BEFORE scheduling)
        sessionData.status = 'bridge_sent';
        sessionData.responseScheduled = true;
        await setTempData(sessionKey, sessionData, 600);
        console.log(`Bridge sent and session updated (bridge_sent + responseScheduled) for ${sessionData.sessionId}`);
      } catch (err) {
        // If sending the bridge failed, revert so someone can retry or fallback
        console.error('Failed to send bridge, reverting session to pending so it can be retried:', err);
        sessionData.status = 'pending';
        sessionData.responseScheduled = false;
        await setTempData(sessionKey, sessionData, 600);
        return;
      }

      // Build botResponse now (same as before)
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

      // Persist again (defensive): ensure responseScheduled is true so duplicates cannot schedule
      sessionData.responseScheduled = true;
      await setTempData(sessionKey, sessionData, 600);

      // Schedule botResponse after 30s
      setTimeout(async () => {
        // Before sending, double-check sessionData still indicates responseScheduled (defensive)
        const latestSession = await getTempData(sessionKey);
        if (!latestSession || !latestSession.responseScheduled) {
          console.log(`Response not scheduled or session missing for ${sessionData.sessionId}; skipping botResponse.`);
          return;
        }

        try {
          if (companyData['COMPANY IMAGE']) {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(companyData['COMPANY IMAGE']);
            const buffer = await response.buffer();
            const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `${companyData.COMPANY}.jpg`);
            await msg.reply(media, null, { caption: botResponse });
          } else {
            await msg.reply(botResponse);
          }
        } catch (err) {
          console.error('Error sending botResponse:', err);
          try { await msg.reply(botResponse); } catch (e) { console.error('Also failed fallback text send:', e); }
        } finally {
          // cleanup and mark completed_user flag (so fallback never triggers later)
          await deleteTempData(sessionKey);
          await deleteTempData(phoneSessionKey);
          await setTempData(`completed_user_${phoneNumber}`, true, 86400);
          console.log(`Session ${sessionData.sessionId} finished and cleaned up for ${phoneNumber}`);
        }
      }, 30000);
    });

    client.initialize();
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
