// puppeteer.config.cjs
const { join } = require('path');

/** @type {import("puppeteer").Configuration} */
module.exports = {
    // Changes the cache location for Puppeteer to a project-local directory
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};