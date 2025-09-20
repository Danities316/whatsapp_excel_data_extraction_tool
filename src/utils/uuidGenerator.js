// We use 'v4' because it is a random, universally unique identifier
const { v4: uuidv4 } = require('uuid');
// import { v4 as uuidv4 } from 'uuid';

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

// Export the function for use in other modules
export {
    generateUUID
};
