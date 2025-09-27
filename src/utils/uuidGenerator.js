// We use 'v4' because it is a random, universally unique identifier
const { v4: uuidv4 } = require('uuid');

// =================================================================
// UUID Generator Utility
// =================================================================
/**
 * Generates a universally unique identifier (UUID).
 * @returns {string} A new UUID string.
 */
function generateUUID() {
    return uuidv4();
}


export {
    generateUUID
};
