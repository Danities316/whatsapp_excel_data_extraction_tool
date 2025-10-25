const mockRedisClient = {
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    keys: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    quit: jest.fn().mockResolvedValue('OK'),
};

module.exports = {
    redisClient: mockRedisClient,
    initRedis: jest.fn(),
};