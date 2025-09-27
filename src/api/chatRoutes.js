const express = require('express');
const { body, validationResult } = require('express-validator');
const { setTempData, getTempData } = require('../services/tempStoreService.js');

const router = express.Router();

const BOT_PHONE = process.env.BOT_PHONE || ''; 

// Helper function to create session key for phone correlation
function createSessionKey(sessionId) {
    return `session_${sessionId}`;
}

function createPhoneSessionKey(phoneNumber) {
    return `phone_session_${phoneNumber}`;
}

router.post('/initiate-chat',
  body('companyId').trim().notEmpty().withMessage('Company ID is required.'),
  body('imageUrl').notEmpty().withMessage('Invalid image URL'),
  async (req, res) => {
    const errors = validationResult(req);
    // Use dynamic import here
    const { v4: uuidv4 } = await import('uuid');
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { companyId, imageUrl } = req.body;
    const sessionId = uuidv4();
    const timestamp = Date.now();
    
    console.log('Received /api/initiate-chat request:', { companyId, imageUrl, sessionId, timestamp });

    try {
      // Store session data with timestamp
      const sessionData = {
        companyId,
        imageUrl,
        timestamp,
        sessionId,
        status: 'pending' 
      };
      
      // Store session data with 10-minute expiry (600 seconds)
      await setTempData(createSessionKey(sessionId), sessionData, 600);
      console.log('Storing session data:', { sessionId, data: sessionData });
      // Clean user message without any session ID
      const userMessage = "Hello, I am interested in your services for a move.";
      
      const waLink = `https://wa.me/${BOT_PHONE.replace('+', '').replace(/\s/g, '')}?text=${encodeURIComponent(userMessage)}`;

      console.log(`Generated WhatsApp link: ${waLink}`);
      res.status(200).json({
        message: 'WhatsApp chat link generated successfully.',
        waLink,
        sessionId 
      });
    } catch (error) {
      console.error('Error in /api/initiate-chat:', error);
      res.status(500).json({ message: 'Failed to generate chat link. Please try again.' });
    }
  }
);

// =================================================================
// GET /chat-redirect
// Validates sessionId and redirects to a clean WhatsApp chat link
// =================================================================
router.get('/chat-redirect', async (req, res) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).send('Missing sessionId');
    }

    // Validate session exists
    const sessionKey = `session_${sessionId}`;
    const sessionData = await getTempData(sessionKey);

    if (!sessionData) {
      return res.status(400).send('Invalid or expired session.');
    }

    // Generate clean WhatsApp link (no sessionId in text!)
    const userMessage = "Hello, I am interested in your services.";
    const waLink = `https://wa.me/${BOT_PHONE.replace('+', '').replace(/\s/g, '')}?text=${encodeURIComponent(userMessage)}`;

    // Redirect user to WhatsApp
    return res.redirect(waLink);
  } catch (error) {
    console.error('Error in /chat-redirect:', error);
    return res.status(500).send('Something went wrong.');
  }
});

// Optional: Endpoint to check session status (for debugging)
router.get('/session-status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = await getTempData(createSessionKey(sessionId));
    
    if (sessionData) {
      // Handle both string and object responses
      const data = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
      const age = Date.now() - data.timestamp;
      res.json({
        exists: true,
        ageMinutes: Math.floor(age / 60000),
        data: data
      });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking session status:', error);
    res.status(500).json({ error: 'Failed to check session status' });
  }
});

module.exports = { router };
