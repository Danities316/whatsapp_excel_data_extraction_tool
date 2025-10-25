const { initRedis, redisClient } = require('../config/redisClient.js');

// =================== Idempotency & Lock Helpers ===================

// Prevent double-processing of the same WhatsApp message
async function isDuplicateMessage(msgId) {
    const key = `msg:${msgId}`;
    const alreadyProcessed = await redisClient.exists(key);
    if (alreadyProcessed) return true;
    await redisClient.setEx(key, 120, '1'); // 2 min TTL to avoid duplicates
    return false;
}

// Prevent concurrent session claim
async function acquireSessionLock(sessionId) {
    const lockKey = `lock:${sessionId}`;
    const acquired = await redisClient.set(lockKey, 1, { NX: true, EX: 60 }); // lock for 60s
    return !!acquired;
}

// Prevent sending same bridge message twice
async function bridgeAlreadySent(sessionId) {
    const key = `bridge_sent_${sessionId}`;
    const exists = await redisClient.exists(key);
    if (exists) return true;
    await redisClient.setEx(key, 300, "1"); // lock for 5 min
    return false;
}

// Prevent sending same bot response twice
// async function botResponseAlreadySent(sessionId) {
//     const key = `bot_response_sent_${sessionId}`;
//     const exists = await redisClient.exists(key);
//     if (exists) return true;
//     await redisClient.setEx(key, 3600, "1");
//     return false;
// }

async function botResponseAlreadySent(sessionId) {
    const key = `bot_response_sent_${sessionId}`;
    const exists = await redisClient.exists(key);
    return exists > 0;
}

async function markBotResponseSent(sessionId) {
    const key = `bot_response_sent_${sessionId}`;
    await redisClient.set(key, '1', { EX: 3600 }); // mark only after success
}



module.exports = {
    isDuplicateMessage,
    acquireSessionLock,
    bridgeAlreadySent,
    botResponseAlreadySent,
    markBotResponseSent
}