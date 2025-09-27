const { redisClient } = require('../config/redisClient.js');



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
      let toStore;

      if (typeof value === 'string') {
        // Already a JSON string → store as is
        toStore = value;
      } else if (typeof value === 'object') {
        // Convert objects properly
        toStore = JSON.stringify(value);
      } else {
        // Fallback: wrap primitive types
        toStore = JSON.stringify({ value });
      }

      await redisClient.set(key, toStore, { EX: ttl });

      console.log(
        `Successfully set key "${key}" in Redis with TTL ${ttl} seconds. Value:`,
        value
      );
    } catch (error) {
      console.error(`Failed to set key "${key}" in Redis:`, error);
      throw error;
    }
  };

  await pRetry(run, { retries: 3, minTimeout: 1000 });
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

    try {
      const parsed = JSON.parse(value); // Works if stored as JSON
      console.log(`Parsed JSON value for key "${key}":`, parsed);
      return parsed;
    } catch (jsonError) {
      // Not JSON, return as raw string
      console.log(`Raw string value for key "${key}":`, value);
      return value;
    }
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

async function markFallbackReplied(phoneNumber, ttl = 86400) {
  const key = `fallback_user_${phoneNumber}`;
  try {
    await redisClient.set(key, "1", { EX: ttl });
    console.log(`Marked fallback reply sent for ${phoneNumber}, TTL=${ttl}s`);
  } catch (err) {
    console.error(`Error marking fallback for ${phoneNumber}:`, err);
  }
}

async function hasFallbackReplied(phoneNumber) {
  const key = `fallback_user_${phoneNumber}`;
  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    console.error(`Error checking fallback for ${phoneNumber}:`, err);
    return false;
  }
}


async function deleteTempData(key) {
  try {
    const res = await redisClient.del(key);
    console.log(`Deleted key "${key}" from Redis. Result:`, res);
    return res;
  } catch (error) {
    console.error(`Error deleting key "${key}" from Redis:`, error);
    return null;
  }
}


module.exports = { setTempData, getTempData, getAllKeys, markFallbackReplied, hasFallbackReplied, deleteTempData };
