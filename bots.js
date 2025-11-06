const { Client, RemoteAuth, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require('qrcode-terminal');
const {
  getTempData,
  setTempData,
  getAllKeys,
  markFallbackReplied,
  hasFallbackReplied,
  deleteTempData
} = require("./src/services/tempStoreService.js");
const { getCompanyData } = require("./src/services/googleSheetsService.js");
const mongoose = require("mongoose");
const { MongoStore } = require('wwebjs-mongo');
const puppeteer = require('puppeteer');
const dotenv = require("dotenv");
const { initRedis, redisClient } = require('./src/config/redisClient.js');

const {
  acquireSessionLock,
  isDuplicateMessage,
  bridgeAlreadySent,
  botResponseAlreadySent,
  markBotResponseSent
} = require('./src/utils/helperFunctions.js');

dotenv.config();

const BOT_PHONE = process.env.BOT_PHONE || '';
initRedis();
console.log('Redis client is connected and ready. ✅');

// Helper utilities (kept from original)
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
          if (!data.timestamp) continue;

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
  if (sessionData) return sessionData;

  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  const match = msg.body && msg.body.match ? msg.body.match(uuidRegex) : null;
  if (match) {
    const sessionId = match[0];
    const sessionDataStr = await getTempData(createSessionKey(sessionId));
    if (sessionDataStr) {
      return typeof sessionDataStr === 'string' ? JSON.parse(sessionDataStr) : sessionDataStr;
    }
  }

  return null;
}

process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && reason.message.includes('Execution context was destroyed')) {
    console.warn('⚠️ Puppeteer page reloaded — safe to ignore.');
  } else {
    console.error('Unhandled Rejection:', reason);
  }
});

// Init Mongo + WhatsApp client
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("MongoDB connected successfully. Session store is ready.");
    
    // DETAILED SESSION CHECK
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("📦 Available collections:", collections.map(c => c.name));
    
    const remoteAuthCollections = collections.filter(c => 
      c.name.includes('RemoteAuth') || c.name.includes('whatsapp')
    );
    console.log("🔍 RemoteAuth collections:", remoteAuthCollections.map(c => c.name));
    
    try {
      const chunksCollection = mongoose.connection.collection('whatsapp-RemoteAuth-whatsapp_msf_bot.chunks');
      const chunkCount = await chunksCollection.countDocuments();
      console.log(`✅ Found ${chunkCount} chunks in session storage`);
      
      const filesCollection = mongoose.connection.collection('whatsapp-RemoteAuth-whatsapp_msf_bot.files');
      const fileCount = await filesCollection.countDocuments();
      console.log(`📄 Found ${fileCount} file(s) in session metadata`);
      
      if (fileCount > 0) {
        const latestFile = await filesCollection.findOne({}, { sort: { uploadDate: -1 } });
        console.log("📅 Latest session upload date:", latestFile?.uploadDate);
        console.log("🆔 Session file ID:", latestFile?._id);
        console.log("📏 Session file length:", latestFile?.length, "bytes");
      }
    } catch (err) {
      console.error("❌ Error checking chunks:", err.message);
    }
    
    const store = new MongoStore({ mongoose: mongoose });
    
    // CRITICAL FIX: Add event listeners to monitor session extraction
    store.on('extract', (sessionId) => {
      console.log('🔄 MongoStore extracting session:', sessionId);
    });
    
    store.on('save', (sessionId) => {
      console.log('💾 MongoStore saved session:', sessionId);
    });

    const isWindows = process.platform === 'win32';
    
    const client = new Client({
      authStrategy: new RemoteAuth({
        store: store,
        clientId: 'whatsapp_msf_bot',
        backupSyncIntervalMs: 300000,
        dataPath: './.wwebjs_auth' // Add explicit dataPath
      }),
      puppeteer: {
        headless: true,
        executablePath: isWindows
          ? undefined
          : process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--single-process',
          '--disable-extensions',
          '--window-size=800,600'
        ],
        ignoreHTTPSErrors: true,
        protocolTimeout: 240000, // Increase to 4 minutes for slow connections
        pipe: true,
      },
      takeoverOnConflict: true,
      restartOnAuthFail: false, // CHANGED: Don't auto-restart on auth fail
    });

    // CRITICAL: Add more detailed event listeners
    client.on('remote_session_saved', () => {
      console.log('✅ Remote session successfully saved to MongoDB');
    });

    client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading WhatsApp Web: ${percent}% - ${message}`);
    });

    client.on("qr", async (qr) => {
      console.error("⚠️ QR Code requested - this means session restore FAILED");
      console.error("Possible reasons:");
      console.error("1. Session expired on WhatsApp servers (>14 days inactive)");
      console.error("2. Session data corrupted in MongoDB");
      console.error("3. MongoDB connection slow/timeout during restore");
      console.error("4. wwebjs-mongo version incompatibility");
      
      // Don't clear sessions automatically on QR - let user decide
      console.log("\n🔄 Scan QR code to create new session...\n");
      qrcode.generate(qr, { small: true });
    });

    client.on("authenticated", () => {
      console.log("✅ Authentication successful!");
    });

    client.on("auth_failure", async (msg) => {
      console.error("❌ Authentication failure:", msg);
      // Only log, don't clear sessions
      console.error("Session may need to be cleared manually if issue persists");
    });

    client.on('disconnected', (reason) => {
      console.log('⚠️ Client was disconnected!', reason);
      // Don't auto-clear on disconnect
    });

    client.on("ready", () => {
      console.log("✅ WhatsApp bot client is ready!");
      console.log("📱 Bot is now listening for messages...");
    });

    // Message handler (unchanged from your original)
    client.on('message', async (msg) => {
      if (msg.body === '!ping') {
        msg.reply('pong');
        return;
      }

      if (
        msg.from === 'status@broadcast' ||
        msg.fromMe ||
        msg.author ||
        msg.from.endsWith('@g.us')
      ) {
        console.log(`Ignoring non-direct message: from=${msg.from}, author=${msg.author}`);
        return;
      }

      const traceId = Date.now() + Math.random().toString(36).substring(2, 8);
      console.log(`[${traceId}] 💬 Message received from ${msg.from} : ${String(msg.body || '').slice(0, 120)}`);

      const msgId = msg?.id?.id ?? null;
      if (msgId) {
        try {
          const isDup = await isDuplicateMessage(msgId);
          if (isDup) {
            console.log(`[${traceId}] Duplicate message ignored msgId=${msgId}`);
            return;
          }
        } catch (err) {
          console.warn(`[${traceId}] Warning: isDuplicateMessage failed, continuing.`, err);
        }
      }

      const phoneNumberRaw = String(msg.from).split('@')[0];
      const phoneNumber = normalizePhoneNumber(phoneNumberRaw);
      const phoneSessionKey = `phone_session_${phoneNumber}`;

      const extractSessionId = (raw) => {
        if (!raw) return null;
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'object' && raw.sessionId) return raw.sessionId;
        return null;
      };

      let sessionData = null;

      try {
        const rawPhoneSession = await getTempData(phoneSessionKey);
        const mappedSessionId = extractSessionId(rawPhoneSession);
        if (mappedSessionId) {
          const maybeSession = await getTempData(`session_${mappedSessionId}`);
          if (maybeSession && maybeSession.companyId) {
            sessionData = maybeSession;
            console.log(`[${traceId}] Found existing mapped session ${mappedSessionId} for ${phoneNumber}`);
          } else {
            console.warn(`[${traceId}] Found phone_session mapping but session missing/invalid. mapped=${mappedSessionId}`);
          }

          if (sessionData) {
            const status = sessionData.status;

            if (status === 'bridge_sending') {
              console.log(`[${traceId}] Bridge is currently being sent for session ${sessionData.sessionId}.`);
              await msg.reply(
                `🕐 We're sending the company details for your previous request right now.\n` +
                `Please hold on — you'll receive the full information in just a moment. 🙏`
              );
              return;
            }

            if (status === 'bridge_sent' && sessionData.responseScheduled) {
              console.log(`[${traceId}] User ${phoneNumber} re-clicked while botResponse is pending for session ${sessionData.sessionId}.`);
              await msg.reply(
                `⏳ Your request for *${sessionData.companyName || 'this company'}* is still being processed.\n` +
                `You'll receive the detailed response shortly. Please wait a few seconds 🙏`
              );
              return;
            }

            if (status === 'response_sent') {
              console.log(`[${traceId}] Session ${sessionData.sessionId} already completed (response_sent).`);
              await msg.reply(
                `✅ You already received full details for *${sessionData.companyName || 'this company'}*.\n` +
                `If you'd like to explore other moving services, please return to our website and select another option 🚚✨`
              );
              return;
            }
          }
        }
      } catch (err) {
        console.error(`[${traceId}] Error reading phone->session mapping`, err);
      }

      let sessionKey = null;
      let sessionId = null;
      let lockAcquired = false;

      if (!sessionData) {
        try {
          const allKeys = await getAllKeys('session_*');
          const now = Date.now();

          for (const k of allKeys) {
            try {
              const candidate = await getTempData(k);
              if (!candidate) continue;
              if (candidate.status !== 'pending') continue;
              if ((now - (candidate.timestamp || 0)) > 10 * 60 * 1000) continue;

              const candidateSessionId = candidate.sessionId || k;
              const acquired = await acquireSessionLock(candidateSessionId);
              if (!acquired) {
                console.log(`[${traceId}] Could not acquire lock for ${candidateSessionId}, skipping candidate.`);
                continue;
              }

              lockAcquired = true;
              sessionKey = k;
              sessionId = candidateSessionId;

              await setTempData(phoneSessionKey, candidateSessionId, 600);
              candidate.phone = phoneNumber;
              candidate.status = 'active';
              await setTempData(k, candidate, 600);

              sessionData = candidate;
              console.log(`[${traceId}] Claimed session ${sessionId} for ${phoneNumber}`);
              break;
            } catch (e) {
              console.warn(`[${traceId}] Error evaluating candidate session key ${k}`, e);
              continue;
            }
          }
        } catch (err) {
          console.error(`[${traceId}] Error scanning sessions:`, err);
        }
      } else {
        sessionKey = `session_${sessionData.sessionId}`;
        sessionId = sessionData.sessionId;
      }

      if (!sessionData) {
        try {
          if (!(await hasFallbackReplied(phoneNumber))) {
            await markFallbackReplied(phoneNumber);
            await msg.reply(
              `This is the official contact line for www.movingservicefinland.com.\n` +
              `It looks like you're trying to inquire about our services.\n` +
              `Please visit our website to book, find, and compare prices.\n` +
              `Thanks for reaching out!`
            );
          } else {
            console.log(`[${traceId}] Fallback already sent recently to ${phoneNumber}; skipping.`);
          }
        } catch (err) {
          console.warn(`[${traceId}] Error during fallback flow`, err);
        }
        return;
      }

      if (!sessionId) sessionId = sessionData.sessionId || sessionKey;
      if (!sessionKey) sessionKey = `session_${sessionId}`;

      if (!lockAcquired) {
        try {
          lockAcquired = await acquireSessionLock(sessionId);
          if (!lockAcquired) {
            console.log(`[${traceId}] Failed to acquire lock for session ${sessionId} (already claimed). Ignoring.`);
            return;
          }
        } catch (err) {
          console.warn(`[${traceId}] Error acquiring lock for session ${sessionId}`, err);
          return;
        }
      }

      const companyId = sessionData.companyId;
      const completedKeyForCompany = `completed_user_${phoneNumber}_${companyId}`;
      try {
        if (await getTempData(completedKeyForCompany)) {
          console.log(`[${traceId}] User ${phoneNumber} recently completed chat with company ${companyId}.`);
          let companyName = '(this moving service)';
          try { const cd = await getCompanyData(companyId); companyName = cd?.COMPANY || companyName; } catch (_) { }
          await msg.reply(
            `👋 Hi again! You recently contacted *${companyName}* through MSF. ` +
            `If you want to explore other moving services, please return to the website and choose another option. 🚚`
          );
          try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
          return;
        }
      } catch (err) {
        console.warn(`[${traceId}] Warning reading completed_key for company`, err);
      }

      try {
        const alreadyBridge = await bridgeAlreadySent(sessionId);
        if (alreadyBridge) {
          console.log(`[${traceId}] Bridge already sent for ${sessionId}; releasing lock and aborting.`);
          try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
          return;
        }
      } catch (err) {
        console.warn(`[${traceId}] bridgeAlreadySent check failed for ${sessionId}`, err);
      }

      let companyData;
      try {
        companyData = await getCompanyData(sessionData.companyId);
        if (!companyData) {
          await msg.reply('I am sorry, I cannot find the details for this company. Please try again later.');
          try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
          return;
        }
      } catch (err) {
        console.error(`[${traceId}] Error fetching company data for ${sessionData.companyId}`, err);
        try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
        return;
      }

      const bridgeMsg = companyData['BRIDGE MESSAGE']?.trim() || '';
      const formattedBridgeMsg = bridgeMsg
        .replace(/MSF!/i, '*MSF!*')
        .replace(/Company Name:/i, '*Company Name:*')
        .replace(/Services Offered:/i, '*Services Offered:*')
        .replace(/Cost:/i, '*Cost:*')
        .replace(/Service Area:/i, '*Service Area:*')
        .replace(/!/g, '\n')
        .replace(/;/g, '\n');

      try {
        await msg.reply(
          `✅ Got it! I'm fetching details for *${companyData?.COMPANY || 'your selected company'}*. Please hold on... 🚚💨`
        );
        console.log(`[${traceId}] Sent quick acknowledgment to ${phoneNumber}`);
      } catch (err) {
        console.warn(`[${traceId}] Failed to send quick acknowledgment message`, err);
      }

      try {
        sessionData.status = 'bridge_sending';
        await setTempData(sessionKey, sessionData, 600);
      } catch (err) {
        console.error(`[${traceId}] Failed to persist bridge_sending state, aborting to avoid dupes:`, err);
        try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
        return;
      }

      try {
        if (formattedBridgeMsg) {
          if (sessionData.imageUrl) {
            try {
              const fetch = (await import('node-fetch')).default;
              const response = await fetch(sessionData.imageUrl);
              if (!response.ok) throw new Error(`Image fetch ${response.status}`);
              const arrayBuf = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `company-${sessionData.companyId}.jpg`);
              await msg.reply(media, null, { caption: formattedBridgeMsg });
            } catch (err) {
              console.error(`[${traceId}] Error fetching/sending bridge image, sending text instead:`, err);
              await msg.reply(formattedBridgeMsg);
            }
          } else {
            await msg.reply(formattedBridgeMsg);
          }
        }

        sessionData.status = 'bridge_sent';
        sessionData.responseScheduled = true;
        await setTempData(sessionKey, sessionData, 600);
        console.log(`[${traceId}] Bridge sent & session updated (bridge_sent + responseScheduled) for ${sessionId}`);
      } catch (err) {
        console.error(`[${traceId}] Failed to send bridge, reverting session to pending:`, err);
        sessionData.status = 'pending';
        sessionData.responseScheduled = false;
        try { await setTempData(sessionKey, sessionData, 600); } catch (e) { console.warn(e); }
        try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
        return;
      }

      try { await redisClient.del(`lock:${sessionId}`); } catch (err) { console.warn(`[${traceId}] Failed to release lock for ${sessionId}`, err); }

      const botResponse = `🏢 *${companyData.COMPANY}*\n\n` +
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

      try {
        sessionData.responseScheduled = true;
        await setTempData(sessionKey, sessionData, 600);
      } catch (err) {
        console.warn(`[${traceId}] Warning: Could not persist responseScheduled flag`, err);
      }

      const BOT_DELAY_MS = Number(process.env.BOT_RESPONSE_DELAY_MS) || 30000;
      setTimeout(async () => {
        try {
          const latestSession = await getTempData(sessionKey);
          if (!latestSession || !latestSession.responseScheduled) {
            console.log(`[${traceId}] Response not scheduled or session missing for ${sessionId}; skipping botResponse.`);
            return;
          }

          const already = await botResponseAlreadySent(sessionId);
          if (already) {
            console.log(`[${traceId}] Bot response already sent earlier for ${sessionId}.`);
            return;
          }

          if (companyData['COMPANY IMAGE']) {
            try {
              const fetch = (await import('node-fetch')).default;
              const response = await fetch(companyData['COMPANY IMAGE']);
              if (!response.ok) throw new Error(`Image fetch ${response.status}`);
              const arrayBuf = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              const media = new MessageMedia('image/jpeg', buffer.toString('base64'), `${companyData.COMPANY}.jpg`);
              await msg.reply(media, null, { caption: botResponse });
            } catch (err) {
              console.error(`[${traceId}] Error sending company image in botResponse; falling back to text`, err);
              await msg.reply(botResponse);
            }
          } else {
            await msg.reply(botResponse);
          }

          try {
            await markBotResponseSent(sessionId);
          } catch (err) {
            console.warn(`[${traceId}] Warning: markBotResponseSent failed`, err);
          }

          await new Promise(r => setTimeout(r, 1500));

          try {
            const latest = await getTempData(sessionKey);
            if (latest) {
              latest.status = 'response_sent';
              latest.completedAt = Date.now();
              await setTempData(sessionKey, latest, 1800);
            }
          } catch (err) {
            console.warn(`[${traceId}] Could not update session post-response`, err);
          }

          try {
            await deleteTempData(phoneSessionKey);
            const COMPLETED_TTL = Number(process.env.COMPLETED_USER_TTL) || 3600;
            await setTempData(`completed_user_${phoneNumber}_${companyId}`, true, COMPLETED_TTL);
            console.log(`[${traceId}] ✅ BotResponse sent & session marked completed for ${sessionId}`);
          } catch (err) {
            console.warn(`[${traceId}] Cleanup after botResponse failed for ${sessionId}`, err);
          }

        } catch (err) {
          console.error(`[${traceId}] ❌ Error in scheduled botResponse for ${sessionId}:`, err);
        }
      }, BOT_DELAY_MS);

    });

    console.log("🚀 Initializing WhatsApp client...");
    client.initialize();
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
