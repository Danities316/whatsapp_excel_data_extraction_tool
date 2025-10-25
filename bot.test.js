// 1. Mock WWebJs client and MongoStore
const { Client } = require("whatsapp-web.js");
const { MongoStore } = require('wwebjs-mongo');
jest.mock('whatsapp-web.js');
jest.mock('wwebjs-mongo');

// 2. Mock services
const { getTempData, setTempData, getAllKeys, markFallbackReplied, hasFallbackReplied, deleteTempData } = require("./src/services/tempStoreService.js");
const { getCompanyData } = require("./src/services/googleSheetsService.js");
jest.mock('./src/services/tempStoreService.js');
jest.mock('./src/services/googleSheetsService.js');

// 3. Mock node-fetch for image handling
const mockFetch = jest.fn();
jest.mock('node-fetch', () => ({
    __esModule: true,
    default: mockFetch
}));

// 4. Set up fake timers (crucial for 30s delay)
jest.useFakeTimers();

// 5. Mock environment
process.env.MONGODB_URI = 'mongodb://mock/db';
process.env.BOT_PHONE = '+1234567890';
// Mock company data for easy reference
const MOCK_COMPANY_DATA = {
    'ID': 'C001',
    'BRIDGE MESSAGE': 'MSF! Bridge to the company.',
    'COMPANY IMAGE': 'http://example.com/final_image.jpg',
    'COMPANY': 'Mock Movers',
    'OWNER / DRIVER': 'John Doe',
    'LANGUAGES - A': 'English',
    'LANGUAGES - B': 'Finnish',
    'RATE & SERVICES  ( I )': 'R1',
    'RATE & SERVICES  ( II )': 'R2',
    'RATE & SERVICES  ( III )': 'R3',
    'RATE & SERVICES  ( IV )': 'R4',
    'VEHICLE MODEL': 'Van X',
    'LICENSED': 'Yes',
    'COVERAGE': 'Helsinki',
    'SERVICES': 'Moving',
    'AVAILABILITY ': '24/7',
    'CONTACT METHOD': 'Phone',
    'THANK YOU MESSAGE': 'Thanks!',
};

// 6. Global variables for easy access to the listener and mocks
let messageListener;
let mockClientInstance;
let client;

// Utility to create a mock message object
const createMockMessage = (from, body = 'Hello') => ({
    from: `${from}@c.us`,
    body,
    reply: jest.fn(),
    // Safety filters
    fromMe: false,
    author: undefined,
});

// Setup the mock client logic
beforeAll(() => {
    // 1. Mock Mongoose to ensure the client initialization runs synchronously.
    jest.doMock('mongoose', () => ({
        connect: jest.fn(() => ({
            // This forces the synchronous call of the success callback
            then: jest.fn(callback => {
                callback(); // Run the logic inside the .then() immediately
                return { catch: jest.fn() }; // Chain a mock catch handler
            }),
            catch: jest.fn(),
        })),
        // Mock any other mongoose properties used in bot.js (like Schema/model)
        Schema: jest.fn(),
        model: jest.fn(() => ({})),
    }));


    // 2. Mock the whatsapp-web.js client
    const mockOn = jest.fn();
    const mockInitialize = jest.fn(() => Promise.resolve());
    const mockSendMessage = jest.fn(() => Promise.resolve());

    jest.doMock('whatsapp-web.js', () => ({
        Client: jest.fn(() => ({
            on: mockOn,
            initialize: mockInitialize,
            sendMessage: mockSendMessage,
        })),
        MessageMedia: jest.fn(function () { this.data = 'mock-media'; }),
        RemoteAuth: jest.fn(),
    }));

    // 3. Load the module under test using isolation
    jest.isolateModules(() => {
        require('./bot.js');
    });

    // 4. Extract the client instance and the listener function (now client should exist)
    const { Client } = require('whatsapp-web.js');

    // Get the instance created in bot.js
    client = Client.mock.instances[0];

    if (!client) {
        throw new Error('WhatsApp Client instance was not created. Check Mongoose mock.');
    }

    // Find the 'message_create' listener
    const messageCreateCall = client.on.mock.calls.find(
        ([event]) => event === 'message_create'
    );

    if (messageCreateCall) {
        messageListener = messageCreateCall[1];
    } else {
        throw new Error("Could not find 'message_create' listener.");
    }
});

beforeEach(() => {
    jest.clearAllMocks();
    // Mock image fetching success by default
    mockFetch.mockResolvedValue({
        buffer: jest.fn().mockResolvedValue(Buffer.from('image_data'))
    });
});

// --- Start the Test Suite ---
describe('WhatsApp Bot E2E Flow', () => {
    const testPhoneNumber = '2348012345678';
    const testSessionId = 'mock-session-id-123';
    const sessionKey = `session_${testSessionId}`;
    const phoneSessionKey = `phone_session_${testPhoneNumber}`;

    // Create a mock pending session data
    const mockPendingSession = {
        companyId: 'C001',
        imageUrl: 'http://example.com/bridge_image.jpg',
        timestamp: Date.now(),
        sessionId: testSessionId,
        status: 'pending'
    };

    // --- 1. Full Success Flow (Session Claiming) ---
    test('should claim a pending session, send bridge, and schedule final response', async () => {
        // Setup: One pending session exists, no phone mapping
        getAllKeys.mockResolvedValue([sessionKey]);
        getTempData.mockImplementation(async (key) => {
            if (key === sessionKey) return mockPendingSession;
            return null; // No phone session key exists
        });
        getCompanyData.mockResolvedValue(MOCK_COMPANY_DATA);

        const msg = createMockMessage(testPhoneNumber);

        // 1. Simulate Incoming Message (Triggers Bridge Send)
        await messageListener(msg);

        // Assertions for Bridge Send:
        expect(getCompanyData).toHaveBeenCalledWith('C001');
        expect(setTempData).toHaveBeenCalledWith(phoneSessionKey, testSessionId, 600); // Phone mapping created

        // Session status updated to 'active' then 'bridge_sending', then 'bridge_sent'
        expect(setTempData).toHaveBeenCalledWith(
            sessionKey,
            expect.objectContaining({ status: 'active' }),
            600
        );
        expect(setTempData).toHaveBeenCalledWith(
            sessionKey,
            expect.objectContaining({ status: 'bridge_sending' }),
            600
        );
        expect(setTempData).toHaveBeenCalledWith(
            sessionKey,
            expect.objectContaining({ status: 'bridge_sent', responseScheduled: true }),
            600
        );

        // Bridge message sent (includes image)
        expect(msg.reply).toHaveBeenCalledTimes(1);
        expect(msg.reply.mock.calls[0][2].caption).toContain('Bridge to the company');

        // 2. Trigger Scheduled Response (30s delay)
        jest.runAllTimers();

        // Assertions for Final Response & Cleanup:
        expect(msg.reply).toHaveBeenCalledTimes(2); // Final response sent
        expect(msg.reply.mock.calls[1][2].caption).toContain('Mock Movers'); // Check for company name
        expect(msg.reply.mock.calls[1][2].caption).toContain('Thanks!'); // Check for thank you message

        // Cleanup verification
        expect(deleteTempData).toHaveBeenCalledWith(sessionKey);
        expect(deleteTempData).toHaveBeenCalledWith(phoneSessionKey);
        expect(setTempData).toHaveBeenCalledWith(`completed_user_${testPhoneNumber}`, true, 86400);
    });

    // --- 2. Duplicate Message Filter ---
    test('should ignore message if session is already bridge_sending/sent', async () => {
        // Setup: Phone is mapped, session is 'bridge_sent'
        getTempData.mockImplementation(async (key) => {
            if (key === phoneSessionKey) return testSessionId;
            if (key === sessionKey) return { ...mockPendingSession, status: 'bridge_sent' };
            return null;
        });
        getCompanyData.mockResolvedValue(MOCK_COMPANY_DATA);

        const msg = createMockMessage(testPhoneNumber);

        await messageListener(msg);

        // Should bail out before fetching company data or replying
        expect(getCompanyData).not.toHaveBeenCalled();
        expect(msg.reply).not.toHaveBeenCalled();
    });

    // --- 3. Fallback Scenario ---
    test('should send fallback message and mark user if no session is found', async () => {
        // Setup: No keys exist, no fallback replied flag
        getAllKeys.mockResolvedValue([]);
        getTempData.mockResolvedValue(null);
        hasFallbackReplied.mockResolvedValue(false);

        const msg = createMockMessage(testPhoneNumber, 'I have no idea what to do.');

        await messageListener(msg);

        // Fallback message sent
        expect(msg.reply).toHaveBeenCalledTimes(1);
        expect(msg.reply.mock.calls[0][0]).toContain('This is the official contact line for www.movingservicefinland.com.');

        // Fallback flag set
        expect(markFallbackReplied).toHaveBeenCalledWith(testPhoneNumber);
    });

    test('should ignore message if no session is found AND fallback has already replied', async () => {
        // Setup: No keys exist, fallback replied flag is true
        getAllKeys.mockResolvedValue([]);
        getTempData.mockResolvedValue(null);
        hasFallbackReplied.mockResolvedValue(true);

        const msg = createMockMessage(testPhoneNumber, 'I have no idea what to do.');

        await messageListener(msg);

        // Fallback message not sent
        expect(msg.reply).not.toHaveBeenCalled();
        expect(markFallbackReplied).not.toHaveBeenCalled();
    });

    // --- 4. Stale Session Data and Cleanup ---
    test('should not process if phone mapping is stale (session key missing)', async () => {
        // Setup: Phone mapping exists, but session data is missing/expired
        getTempData.mockImplementation(async (key) => {
            if (key === phoneSessionKey) return testSessionId;
            if (key === sessionKey) return null; // Stale session data
            return null;
        });

        const msg = createMockMessage(testPhoneNumber);

        await messageListener(msg);

        // Should warn and return before processing
        expect(getCompanyData).not.toHaveBeenCalled();
        expect(msg.reply).not.toHaveBeenCalled();
    });

});