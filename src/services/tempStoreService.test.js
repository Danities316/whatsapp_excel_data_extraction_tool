const { setTempData, getTempData, getAllKeys, markFallbackReplied, hasFallbackReplied, deleteTempData } = require('./tempStoreService.js');

// 1. Mock the redisClient and p-retry
const { redisClient } = require('../config/redisClient.js');
jest.mock('p-retry', () => jest.fn((fn) => fn())); // Mock p-retry to execute immediately
jest.mock('../config/redisClient.js', () => ({
    redisClient: {
        get: jest.fn(),
        set: jest.fn().mockResolvedValue('OK'),
        keys: jest.fn().mockResolvedValue([]),
        del: jest.fn().mockResolvedValue(1),
        exists: jest.fn().mockResolvedValue(0),
    },
}));


describe('tempStoreService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // --- setTempData Tests ---
    describe('setTempData', () => {
        test('should store an object as JSON string with a custom TTL', async () => {
            const data = { id: 'test-123', value: 456 };
            await setTempData('session_1', data, 120);

            expect(redisClient.set).toHaveBeenCalledWith(
                'session_1',
                JSON.stringify(data),
                { EX: 120 }
            );
        });

        test('should store a string as-is with default TTL (3600)', async () => {
            const data = 'raw_string_data';
            await setTempData('key_string', data);

            expect(redisClient.set).toHaveBeenCalledWith(
                'key_string',
                data,
                { EX: 3600 }
            );
        });

        test('should throw error for invalid input', async () => {
            await expect(setTempData('key', undefined)).rejects.toThrow();
            expect(redisClient.set).not.toHaveBeenCalled();
        });
    });

    // --- getTempData Tests ---
    describe('getTempData', () => {
        test('should return null if key is not found', async () => {
            redisClient.get.mockResolvedValue(null);
            const result = await getTempData('non_existent');
            expect(result).toBeNull();
        });

        test('should return parsed object for JSON string', async () => {
            const data = { id: 'test-123', status: 'active' };
            redisClient.get.mockResolvedValue(JSON.stringify(data));
            const result = await getTempData('session_1');
            expect(result).toEqual(data);
        });

        test('should return raw string if not valid JSON', async () => {
            const rawString = 'just_a_simple_value';
            redisClient.get.mockResolvedValue(rawString);
            const result = await getTempData('key_raw');
            expect(result).toBe(rawString);
        });
    });

    // --- Fallback/Misc Tests ---
    describe('fallback and utility functions', () => {
        test('markFallbackReplied should set key with 86400s TTL', async () => {
            const phone = '2348012345678';
            await markFallbackReplied(phone);
            expect(redisClient.set).toHaveBeenCalledWith(
                `fallback_user_${phone}`,
                '1',
                { EX: 86400 }
            );
        });

        test('hasFallbackReplied should return true if key exists', async () => {
            redisClient.exists.mockResolvedValue(1);
            const result = await hasFallbackReplied('2348012345678');
            expect(result).toBe(true);
        });

        test('deleteTempData should call del and return result', async () => {
            redisClient.del.mockResolvedValue(1);
            const result = await deleteTempData('key_to_delete');
            expect(redisClient.del).toHaveBeenCalledWith('key_to_delete');
            expect(result).toBe(1);
        });

        test('getAllKeys should call keys with the pattern', async () => {
            redisClient.keys.mockResolvedValue(['session_1', 'session_2']);
            const result = await getAllKeys('session_*');
            expect(redisClient.keys).toHaveBeenCalledWith('session_*');
            expect(result).toEqual(['session_1', 'session_2']);
        });
    });
});