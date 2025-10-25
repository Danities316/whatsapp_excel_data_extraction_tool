const mockSheets = {
    spreadsheets: {
        values: {
            get: jest.fn(),
        },
    },
};

module.exports = { sheets: mockSheets };