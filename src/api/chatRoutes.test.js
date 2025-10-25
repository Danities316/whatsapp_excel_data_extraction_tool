const request = require('supertest');
const express = require('express');
const { router } = require('./chatRoutes.js');

// 1. Mock external dependencies
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-session-id'),
}));
const { setTempData, getTempData } = require('../services/tempStoreService.js');
jest.mock('../services/tempStoreService.js', () => ({
    setTempData: jest.fn().mockResolvedValue(),
    getTempData: jest.fn(),
}));

// Mock environment variables
process.env.BOT_PHONE = '+2357035545188';

// 2. Setup a minimal Express app for Supertest
const app = express();
app.use(express.json());
app.use(router);



describe('chatRoutes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // --- POST /initiate-chat Tests ---
    describe('POST /initiate-chat', () => {
        const payload = {
            companyId: 'C001',
            imageUrl: 'http://example.com/image.jpg'
        };
        const expectedSessionKey = 'session_mock-session-id';
        const expectedWaLink = 'https://wa.me/2357035545188?text=Hello%2C%20I%20am%20interested%20in%20your%20services%20for%20a%20move.';


        test('should return 200 and a valid WhatsApp link on success', async () => {
            const res = await request(app)
                .post('/initiate-chat')
                .send(payload);

            expect(res.statusCode).toBe(200);
            expect(res.body.sessionId).toBe('mock-session-id');
            expect(res.body.waLink).toBe(expectedWaLink);

            // Verify session data storage
            expect(setTempData).toHaveBeenCalledTimes(1);
            const storedData = setTempData.mock.calls[0][1];

            expect(setTempData).toHaveBeenCalledWith(
                expectedSessionKey,
                expect.objectContaining({
                    companyId: 'C001',
                    imageUrl: 'http://example.com/image.jpg',
                    sessionId: 'mock-session-id',
                    status: 'pending'
                }),
                600
            );
        });

        test('should return 400 if companyId is missing', async () => {
            const res = await request(app)
                .post('/initiate-chat')
                .send({ imageUrl: payload.imageUrl });

            expect(res.statusCode).toBe(400);
            expect(res.body.errors[0].msg).toBe('Company ID is required.');
            expect(setTempData).not.toHaveBeenCalled();
        });
    });


});