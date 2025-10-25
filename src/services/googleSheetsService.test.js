const { getCompanyData, getAllCompanies } = require('./googleSheetsService.js');

// 1. Mock the googleCliemt module
const { sheets } = require('./googleCliemt.js');
jest.mock('./googleCliemt.js');

// Mock environment variable
process.env.GOOGLE_SHEET_ID = 'mock-sheet-id';

const mockHeaders = [
    'ID', 'BRIDGE MESSAGE', 'COMPANY IMAGE', 'COMPANY', 'OWNER / DRIVER', 'LANGUAGES - A',
    'LANGUAGES - B', 'RATE & SERVICES  ( I )', 'RATE & SERVICES  ( II )',
    'RATE & SERVICES  ( III )', 'RATE & SERVICES  ( IV )', 'VEHICLE MODEL', 'LICENSED',
    'COVERAGE', 'SERVICES', 'CUSTOM OFFERS', 'AVAILABILITY ', 'CONTACT METHOD', 'THANK YOU MESSAGE'
];

const mockCompanyRow = [
    'C001', 'Mock Bridge Msg', 'http://img.url', 'Mock Movers', 'John Doe', 'English',
    'Finnish', 'R1', 'R2', 'R3', 'R4', 'Van X', 'Yes', 'Helsinki', 'Moving, Cleaning',
    'None', '24/7', 'Phone', 'Thanks!'
];

const createMockResponse = (rows = []) => ({
    data: { values: [mockHeaders, ...rows] }
});

describe('googleSheetsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // --- getCompanyData Tests ---
    describe('getCompanyData', () => {
        test('should fetch and parse company data successfully', async () => {
            sheets.spreadsheets.values.get.mockResolvedValue(createMockResponse([mockCompanyRow]));

            const companyData = await getCompanyData('C001');

            expect(sheets.spreadsheets.values.get).toHaveBeenCalledTimes(1);
            expect(companyData).not.toBeNull();
            expect(companyData.ID).toBe('C001');
            expect(companyData.COMPANY).toBe('Mock Movers');
        });

        test('should return null if company ID is not found', async () => {
            // Mock a sheet with only C001, but search for C002
            sheets.spreadsheets.values.get.mockResolvedValue(createMockResponse([mockCompanyRow]));

            const companyData = await getCompanyData('C002');

            expect(companyData).toBeNull();
        });

        test('should return null if required fields are missing (invalid data)', async () => {
            const invalidRow = [...mockCompanyRow];
            invalidRow[mockHeaders.indexOf('COMPANY')] = ''; // Remove company name
            sheets.spreadsheets.values.get.mockResolvedValue(createMockResponse([invalidRow]));

            const companyData = await getCompanyData('C001');

            expect(companyData).toBeNull();
        });

        test('should return null if API call fails', async () => {
            sheets.spreadsheets.values.get.mockRejectedValue(new Error('API error'));

            const companyData = await getCompanyData('10001');

            expect(companyData).toBeNull();
        });
    });


});