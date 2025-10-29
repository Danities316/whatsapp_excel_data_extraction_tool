const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
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
          // Defensive: ensure timestamp exists
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

// Handle unhandledRejection for puppeteer reload noise
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && reason.message.includes('Execution context was destroyed')) {
    console.warn('⚠️ Puppeteer page reloaded — safe to ignore.');
  } else {
    console.error('Unhandled Rejection:', reason);
  }
});

// Init Mongo + WhatsApp client (same as before)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    const store = new MongoStore({ mongoose: mongoose });
    const isWindows = process.platform === 'win32';
    const isDocker = process.env.DOCKER_ENV === 'true' || process.env.RAILWAY_ENVIRONMENT;
    const client = new Client({
      authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000,
      }),
      puppeteer: {
        headless: true,
        executablePath: isWindows
          ? undefined
          : process.env.PUPPETEER_EXECUTABLE_PATH || require('puppeteer').executablePath(),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-features=site-per-process',
          '--single-process',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--window-size=800,600',
          '--use-gl=swiftshader',
          '--mute-audio',
        ],
        ignoreHTTPSErrors: true,
        protocolTimeout: 0,
        pipe: true, // helps avoid WebSocket disconnections
      },
      takeoverOnConflict: true,
      restartOnAuthFail: true,
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

    // === MAIN MESSAGE HANDLER (merged & hardened) ===
    client.on('message', async (msg) => {
      // ping
      if (msg.body === '!ping') {
        msg.reply('pong');
        return;
      }

      // Safety filters (unchanged)
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

      // --- iOS duplicate delivery protection (idempotency) ---
      const msgId = msg?.id?.id ?? null;
      if (msgId) {
        try {
          const isDup = await isDuplicateMessage(msgId);
          if (isDup) {
            console.log(`[${traceId}] Duplicate message ignored msgId=${msgId}`);
            return;
          }
        } catch (err) {
          // If duplicate check fails, continue (do not block conversation)
          console.warn(`[${traceId}] Warning: isDuplicateMessage failed, continuing.`, err);
        }
      }

      // Normalize phone
      const phoneNumberRaw = String(msg.from).split('@')[0];
      const phoneNumber = normalizePhoneNumber(phoneNumberRaw);
      const phoneSessionKey = `phone_session_${phoneNumber}`;

      // helper to extract mapping
      const extractSessionId = (raw) => {
        if (!raw) return null;
        if (typeof raw === 'string') return raw;
        if (typeof raw === 'object' && raw.sessionId) return raw.sessionId;
        return null;
      };

      // --- If user directly messages the bot with no session, send fallback (old behavior) ---
      // We'll check phone->session mapping first. If not found, we'll search pending sessions.
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

          // old rule: if in-progress states, ignore user message (do nothing)
          // if (sessionData &&
          //   (sessionData.status === 'bridge_sending' ||
          //    sessionData.status === 'bridge_sent' ||
          //    sessionData.status === 'response_sent')) {
          //   console.log(`[${traceId}] Session ${sessionData.sessionId} already in-progress (status=${sessionData.status}). Ignoring.`);
          //   return;
          // }

          if (sessionData) {
            const status = sessionData.status;

            if (status === 'bridge_sending') {
              console.log(`[${traceId}] Bridge is currently being sent for session ${sessionData.sessionId}.`);
              await msg.reply(
                `🕓 We’re sending the company details for your previous request right now.\n` +
                `Please hold on — you’ll receive the full information in just a moment. 🙏`
              );
              return;
            }

            if (status === 'bridge_sent' && sessionData.responseScheduled) {
              console.log(`[${traceId}] User ${phoneNumber} re-clicked while botResponse is pending for session ${sessionData.sessionId}.`);
              await msg.reply(
                `⏳ Your request for *${sessionData.companyName || 'this company'}* is still being processed.\n` +
                `You’ll receive the detailed response shortly. Please wait a few seconds 🙏`
              );
              return;
            }

            if (status === 'response_sent') {
              console.log(`[${traceId}] Session ${sessionData.sessionId} already completed (response_sent).`);
              await msg.reply(
                `✅ You already received full details for *${sessionData.companyName || 'this company'}*.\n` +
                `If you’d like to explore other moving services, please return to our website and select another option 🚚✨`
              );
              return;
            }
          }

        }
      } catch (err) {
        console.error(`[${traceId}] Error reading phone->session mapping`, err);
      }

      // If no mapping, attempt to claim a pending session (same as original)
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
              if ((now - (candidate.timestamp || 0)) > 10 * 60 * 1000) continue; // older than 10m skip

              const candidateSessionId = candidate.sessionId || k;

              // Try lock to avoid race (iOS/dup handlers)
              const acquired = await acquireSessionLock(candidateSessionId);
              if (!acquired) {
                console.log(`[${traceId}] Could not acquire lock for ${candidateSessionId}, skipping candidate.`);
                continue;
              }

              // keep lock info
              lockAcquired = true;
              sessionKey = k;
              sessionId = candidateSessionId;

              // Persist phone->session mapping & mark active
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

      // If after all that we still have no session -> fallback reply (old behavior preserved)
      if (!sessionData) {
        try {
          // use old fallback logic but don't duplicate replies
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

      // Ensure sessionKey/sessionId are set
      if (!sessionId) sessionId = sessionData.sessionId || sessionKey;
      if (!sessionKey) sessionKey = `session_${sessionId}`;

      // If lock not previously acquired (mapped session case), try to acquire now
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

      // Per-company completed_user check (NEW: allows contacting other companies quickly)
      const companyId = sessionData.companyId;
      const completedKeyForCompany = `completed_user_${phoneNumber}_${companyId}`;
      try {
        if (await getTempData(completedKeyForCompany)) {
          // If the user already completed chat with this particular company, reply friendly and stop.
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

      // bridgeAlreadySent dedupe check (read-only)
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

      // Load companyData (unchanged)
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

      // Format bridge message (same as old)
      const bridgeMsg = companyData['BRIDGE MESSAGE']?.trim() || '';
      const formattedBridgeMsg = bridgeMsg
        .replace(/MSF!/i, '*MSF!*')
        .replace(/Company Name:/i, '*Company Name:*')
        .replace(/Services Offered:/i, '*Services Offered:*')
        .replace(/Cost:/i, '*Cost:*')
        .replace(/Service Area:/i, '*Service Area:*')
        .replace(/!/g, '\n')
        .replace(/;/g, '\n');

      // --- QUICK ACKNOWLEDGEMENT MESSAGE (immediate feedback to user) ---
      try {
        await msg.reply(
          `✅ Got it! I’m fetching details for *${companyData?.COMPANY || 'your selected company'}*. Please hold on... 🚚💨`
          // `✅ Got it! Please hold on while I prepare the moving service details for you. 🚚💨`
        );
        console.log(`[${traceId}] Sent quick acknowledgment to ${phoneNumber}`);
      } catch (err) {
        console.warn(`[${traceId}] Failed to send quick acknowledgment message`, err);
      }


      // Mark status = bridge_sending BEFORE sending (old behavior)
      try {
        sessionData.status = 'bridge_sending';
        await setTempData(sessionKey, sessionData, 600);
      } catch (err) {
        console.error(`[${traceId}] Failed to persist bridge_sending state, aborting to avoid dupes:`, err);
        try { await redisClient.del(`lock:${sessionId}`); } catch (_) { }
        return;
      }

      // Send the bridge (image or text) — same behavior with fallback
      try {
        if (formattedBridgeMsg) {
          if (sessionData.imageUrl) {
            try {
              const fetch = (await import('node-fetch')).default;
              const response = await fetch(sessionData.imageUrl);
              if (!response.ok) throw new Error(`Image fetch ${response.status}`);
              // use arrayBuffer (no deprecation)
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

        // After successful send: mark bridge_sent & responseScheduled (old behavior)
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

      // release lock early (we persist bridge_sent to prevent immediate duplicates)
      try { await redisClient.del(`lock:${sessionId}`); } catch (err) { console.warn(`[${traceId}] Failed to release lock for ${sessionId}`, err); }

      // Construct botResponse (same as old)
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

      // persist responseScheduled defensively again
      try {
        sessionData.responseScheduled = true;
        await setTempData(sessionKey, sessionData, 600);
      } catch (err) {
        console.warn(`[${traceId}] Warning: Could not persist responseScheduled flag`, err);
      }

      // Schedule botResponse (deduplicated, resilient)
      const BOT_DELAY_MS = Number(process.env.BOT_RESPONSE_DELAY_MS) || 30000;
      setTimeout(async () => {
        try {
          // Defensive: read latest session state
          const latestSession = await getTempData(sessionKey);
          if (!latestSession || !latestSession.responseScheduled) {
            console.log(`[${traceId}] Response not scheduled or session missing for ${sessionId}; skipping botResponse.`);
            return;
          }

          // If response already sent (flag) skip — read-only check
          const already = await botResponseAlreadySent(sessionId);
          if (already) {
            console.log(`[${traceId}] Bot response already sent earlier for ${sessionId}.`);
            return;
          }

          // Try to send botResponse (image or text)
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

          // Only after successful send: mark bot response sent
          try {
            await markBotResponseSent(sessionId); // helper sets bot_response_sent_<sessionId>
          } catch (err) {
            console.warn(`[${traceId}] Warning: markBotResponseSent failed`, err);
          }

          // Small grace wait and then preserve session for audit & cleanup phone->session mapping
          await new Promise(r => setTimeout(r, 1500));

          try {
            const latest = await getTempData(sessionKey);
            if (latest) {
              latest.status = 'response_sent';
              latest.completedAt = Date.now();
              // keep session around for audit (30 minutes)
              await setTempData(sessionKey, latest, 1800);
            }
          } catch (err) {
            console.warn(`[${traceId}] Could not update session post-response`, err);
          }

          // Remove phone->session mapping and set completed_user per-company TTL
          try {
            await deleteTempData(phoneSessionKey);
            const COMPLETED_TTL = Number(process.env.COMPLETED_USER_TTL) || 3600; // default 1 hour
            await setTempData(`completed_user_${phoneNumber}_${companyId}`, true, COMPLETED_TTL);
            console.log(`[${traceId}] ✅ BotResponse sent & session marked completed for ${sessionId}`);
          } catch (err) {
            console.warn(`[${traceId}] Cleanup after botResponse failed for ${sessionId}`, err);
          }

        } catch (err) {
          console.error(`[${traceId}] ❌ Error in scheduled botResponse for ${sessionId}:`, err);
        }
      }, BOT_DELAY_MS);

    }); // end client.on('message')

    client.initialize();
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
