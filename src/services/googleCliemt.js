const { google } = require('googleapis');

// --- FIX FOR RAILWAY ENV NEWLINE ISSUE ---
let rawCreds = process.env.GOOGLE_SHEETS_CREDENTIALS;

// If Railway expanded "\n" to actual newlines, re-escape them so JSON.parse works
if (rawCreds.includes('\n') && !rawCreds.includes('\\n')) {
  rawCreds = rawCreds.replace(/\n/g, '\\n');
}

const credentials = JSON.parse(rawCreds);

// Restore real newlines inside the private key before using it
if (credentials.private_key) {
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });

module.exports = { sheets };
