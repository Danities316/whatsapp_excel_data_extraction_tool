const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

let credentials;

// ✅ Priority 1: Base64 credentials (for Railway or Render)
if (process.env.GOOGLE_SHEETS_CREDENTIALS) {
  try {
    const decoded = Buffer.from(process.env.GOOGLE_SHEETS_CREDENTIALS, 'base64').toString('utf8');
    credentials = JSON.parse(decoded);
  } catch (err) {
    console.error('❌ Failed to decode GOOGLE_SHEETS_CREDENTIALS:', err);
    process.exit(1);
  }
}
// ✅ Fallback: Local JSON file (for local development)
else {
  const localPath = path.join(__dirname, '../../googlesheetAPI.json');
  if (fs.existsSync(localPath)) {
    credentials = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  } else {
    console.error('❌ No Google credentials found. Please set GOOGLE_SHEETS_CREDENTIALS_BASE64 or add googlesheetAPI.json.');
    process.exit(1);
  }
}

// ✅ Fix newline formatting in private key
if (credentials.private_key) {
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });
module.exports = { sheets };
