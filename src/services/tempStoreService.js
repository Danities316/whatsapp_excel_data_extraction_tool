const { redisClient } = require('../config/redisClient.js');
// const pRetry = require('p-retry');
// =================================================================
// Temporary Data Storage Functions
// =================================================================
/**
 * Sets a value in Redis with a short time-to-live (TTL).
 * @param {string} key The session ID (unique identifier).
 * @param {string} value The company ID associated with the session.
 * @param {number} ttl The expiration time in seconds (e.g., 3600 for 1 hour).
 * @returns {Promise<void>}
 */


async function setTempData(key, value, ttl = 3600) {
  if (!key || value === undefined || value === null) {
    console.error(`Invalid input for setTempData: key=${key}, value=${value}`);
    throw new Error(`Invalid key or value: key=${key}, value=${value}`);
  }

  const { default: pRetry } = await import('p-retry');

  const run = async () => {
    try {
      await redisClient.set(key, value, { EX: ttl });
      console.log(`Successfully set key "${key}" in Redis with TTL ${ttl} seconds. Value:`, value);
    } catch (error) {
      console.error(`Failed to set key "${key}" in Redis:`, error);
      throw error;
    }
  };

  try {
    await pRetry(run, { retries: 3, minTimeout: 1000 });
  } catch (error) {
    console.error(`Error setting data for key "${key}" in Redis after retries:`, error);
    throw error; // Propagate to caller
  }
}

/**
 * Retrieves a value from Redis using its key.
 * @param {string} key The session ID (unique identifier).
 * @returns {Promise<string|null>} The company ID or null if the key does not exist or has expired.
 */

async function getTempData(key) {
  try {
    const value = await redisClient.get(key);
    if (!value) {
      console.log(`No data found for key "${key}" in Redis`);
      return null;
    }
    const parsed = JSON.parse(value); // Parse JSON
    console.log(`Value retrieved for key "${key}":`, parsed);
    return parsed; // Returns { companyId, imageUrl }
  } catch (error) {
    console.error(`Error getting data for key "${key}" from Redis:`, error);
    return null;
  }
}


const getAllKeys = async (pattern = '*') => {
    try {
        // If using Redis
        if (redisClient) {
            return await redisClient.keys(pattern);
        }
        
        // If using in-memory store (fallback)
        if (global.tempStore) {
            return Object.keys(global.tempStore).filter(key => {
                if (pattern === '*') return true;
                // Simple pattern matching - replace * with regex
                const regexPattern = pattern.replace(/\*/g, '.*');
                return new RegExp(`^${regexPattern}$`).test(key);
            });
        }
        
        return [];
    } catch (error) {
        console.error('Error getting keys:', error);
        return [];
    }
};


module.exports = { setTempData, getTempData, getAllKeys };
