const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');


const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, '../../googlesheetAPI.json')));
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

const sheets = google.sheets({ version: 'v4', auth });


module.exports = { sheets };