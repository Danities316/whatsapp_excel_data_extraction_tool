const { sheets } = require('./googleCliemt.js');
const dotenv = require('dotenv');

dotenv.config();

const REQUIRED_FIELDS = ['ID', 'BRIDGE MESSAGE', 'COMPANY IMAGE', 'COMPANY', 'OWNER / DRIVER', 'LANGUAGES - A', 'LANGUAGES - B', 'RATE & SERVICES  ( I )', 'RATE & SERVICES  ( II )', 'RATE & SERVICES  ( III )', 'RATE & SERVICES  ( IV )', 'VEHICLE MODEL', 'LICENSED', 'COVERAGE', 'SERVICES', 'CUSTOM OFFERS', 'AVAILABILITY ', 'CONTACT METHOD', 'THANK YOU MESSAGE'];

/**
 * Validates a single company data object to ensure it has all required fields.
 * @param {object} company - The company object to validate.
 * @returns {boolean} 
 */

function validateCompanyData(company) {
    if (company['ID'] && company['BRIDGE MESSAGE'] && !company['COMPANY']) {
        // console.warn(`company data found (ID). Data:`, company);
        return true;
    }
    for (const field of REQUIRED_FIELDS) {
        if (!company[field]) {
            console.warn(`Skipping invalid company row. Missing field: '${field}'. Data received:`, company);
            return false;
        }
    }

    return true;
}


/**
 * fetch data for a single company from Google Sheets.
 * @param {string} companyId The unique ID of the company to fetch.
 * @returns {object|null} An object containing the company's data, or null if not found or invalid.
 */
async function getCompanyData(companyId) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Helsinki!A:Z', 
        });

        const rows = res.data.values;
        if (!rows || rows.length <= 1) { 
            console.error('No company data found.');
            return null;
        }
          

        const headers = rows[0];
        const idIndex = headers.indexOf('ID');
        // console.error(`Company row found: ${companyRow}`);
        console.error(`Company ID index: ${idIndex}`);
        if (idIndex === -1) {
            console.error('Required header "companyId" not found in the Google Sheet.');
            return null;
        }

        const companyRow = rows.slice(1).find(r => r[idIndex] === companyId);
        console.log(`Company row found: ${companyRow}`);
        
        if (!companyRow) {
            console.error(`Company with ID "${companyId}" not found.`);
            return null;
        }

        // Convert row array to object with header names
        const companyData = Object.fromEntries(
            headers.map((header, i) => [header, companyRow[i]])
        );
        
        if (validateCompanyData(companyData)) {
            return companyData;
        }
        
        return null;

    } catch (error) {
        console.error('Error fetching data from Google Sheets:', error);
        return null;
    }
}


/**
 * Asynchronous function to fetch data for all companies from Google Sheets.
 * @returns {Array<object>} An array of valid company objects.
 */
async function getAllCompanies() {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Helsinki!A:Z', 
        });
        
        const rows = res.data.values;
        if (!rows || rows.length <= 1) {
            console.error('No company data found in the sheet.');
            return [];
        }

        const headers = rows[0];
        const dataRows = rows.slice(1);

        const companies = dataRows.map(row => {
            return Object.fromEntries(
                headers.map((header, i) => [header, row[i]])
            );
        });

        // Filter and return only the valid companies
        return companies.filter(validateCompanyData);

    } catch (error) {
        console.error('Error fetching all companies from Google Sheets:', error);
        return [];
    }
}

// module.exports = { setTempData, getTempData };
module.exports = { getCompanyData, getAllCompanies };
