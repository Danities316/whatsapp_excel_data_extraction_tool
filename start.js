require('dotenv').config();
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const { initRedis, redisClient } = require('./src/config/redisClient.js');

(async () => {
  console.log('🚀 Starting WhatsApp bot...');

  // --- 1️⃣ Connect to Redis ---
   initRedis();

  // --- 2️⃣ Connect to MongoDB ---
  await  mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected.');

  // --- 3️⃣ Create Mongo session store ---
  const store = new MongoStore({ mongoose: mongoose });
  console.log('✅ Session store ready.');

  // --- 4️⃣ Chromium setup ---
//  const chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
//  console.log(`🧭 Using Chromium path: ${chromiumPath}`);
console.log('🌐 Using Browserless endpoint:', "ws://localhost:3000");

  // --- 5️⃣ WhatsApp Client ---
  const client = new Client({
    authStrategy: new RemoteAuth({
      store,
      clientId: 'whatsapp_msf_bot',
      backupSyncIntervalMs: 300000,
    }),
    puppeteer: {
      headless: false,
    //  executablePath: chromiumPath,
browserWSEndpoint: "ws://localhost:3000",
defaultViewport: null,
    slowMo: 50,

 args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--single-process',
        '--mute-audio',
      ],
    },
    takeoverOnConflict: true,
    restartOnAuthFail: true,
  });
process.env.DEBUG = 'puppeteer:*,whatsapp-web.js:*';


  // --- 6️⃣ Log key RemoteAuth events ---
  client.on('remote_session_saved', () => console.log('💾 Remote session saved to MongoDB'));
  client.on('remote_session_restored', () => console.log('♻️ Remote session restored from MongoDB'));
  client.on('ready', () => console.log('✅ WhatsApp bot is ready!'));
  client.on('auth_failure', msg => console.log('❌ Auth failure:', msg));
  client.on('disconnected', reason => console.log('⚠️ Disconnected:', reason));

  // --- 7️⃣ Initialize client ---



  console.log('🕓 Initializing WhatsApp client...');
process.env.DEBUG = 'puppeteer:*';
client.pupPage = null;
client.initialize().then(async () => {
  try {
    client.pupPage = await client.pupBrowser.newPage();
    await client.pupPage.goto('https://web.whatsapp.com', {waitUntil:'load', timeout:60000});
    console.log('🌍 Manual navigation done.');
  } catch (e) {
    console.error('Manual nav error:', e);
  }
});

})();

