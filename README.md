# WhatsApp Moving Service Bot - Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [Configuration](#configuration)
5. [Core Components](#core-components)
6. [API Reference](#api-reference)
7. [Bot Logic Flow](#bot-logic-flow)
8. [Data Storage](#data-storage)
9. [Session Management](#session-management)
10. [Error Handling](#error-handling)
11. [Deployment](#deployment)
12. [Troubleshooting](#troubleshooting)
13. [Best Practices](#best-practices)

---

## Overview

The WhatsApp Moving Service Bot is an automated customer service system that connects potential customers with moving companies in Finland. When a user expresses interest in a moving service through your website, the bot initiates a personalized WhatsApp conversation, delivering company information, pricing, and contact details.

### Key Features

- **Automated WhatsApp Integration**: Seamlessly connects website visitors to WhatsApp conversations
- **Multi-Company Support**: Manages inquiries for multiple moving service providers
- **Session Management**: Tracks user interactions across platforms
- **Duplicate Prevention**: Ensures users don't receive repeated messages
- **Rate Limiting**: Protects against spam and abuse
- **Persistent Authentication**: Maintains WhatsApp connection without frequent re-authentication
- **Image Support**: Sends company logos and promotional images

### Technology Stack

- **Backend**: Node.js with Express
- **WhatsApp Integration**: whatsapp-web.js
- **Database**: MongoDB (session persistence)
- **Cache**: Redis (temporary data & locks)
- **Data Source**: Google Sheets API
- **Browser Automation**: Puppeteer

---

## Architecture

### System Components

```
┌─────────────────┐
│   Our Website  │
│   (Frontend)    │
└────────┬────────┘
         │ HTTP POST /api/initiate-chat
         │
┌────────▼────────┐
│  Express API    │◄──────── Redis (Sessions & Locks)
│  (index.js)     │
└────────┬────────┘
         │
┌────────▼────────┐
│  WhatsApp Bot   │◄──────── MongoDB (Auth Persistence)
│  (bot.js)     │
└────────┬────────┘
         │
┌────────▼────────┐
│ Google Sheets   │
│ (Company Data)  │
└─────────────────┘
```

### Data Flow

1. **User initiates contact** on our website
2. **API creates session** and generates WhatsApp link
3. **User clicks link** and sends message on WhatsApp
4. **Bot matches session** to incoming message
5. **Bot fetches company data** from Google Sheets
6. **Bot sends bridge message** (quick intro)
7. **Bot sends detailed response** (after delay)
8. **Session marked complete** to prevent duplicates

---

## Getting Started

### Prerequisites

- Node.js v16+ and npm
- MongoDB instance (local or cloud)
- Redis instance (local or cloud)
- Google Cloud Project with Sheets API enabled
- WhatsApp Business or personal account

### Installation

```bash
# Clone the repository
git clone https://github.com/Danities316/whatsapp_excel_data_extraction_tool.git
cd whatsapp-moving-service-bot

# Install dependencies
npm install

# Install global dependencies (for production process management)
npm install -g pm2  # Optional
```

### Environment Setup

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=8888
NODE_ENV=production

# WhatsApp Bot Phone Number (with country code)
BOT_PHONE=+358401234567

# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/whatsapp-bot
# Or for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/whatsapp-bot

# Redis Configuration
REDIS_URL=localhost
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=your_redis_password

# Google Sheets API
GOOGLE_SHEET_ID=your_spreadsheet_id
# Base64-encoded service account credentials
GOOGLE_SHEETS_CREDENTIALS=<base64_encoded_json>

# Bot Behavior
BOT_RESPONSE_DELAY_MS=30000  # 30 seconds delay before detailed response
COMPLETED_USER_TTL=3600      # 1 hour cooldown per company

# Puppeteer (Linux/Docker only)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### Google Sheets Setup

Your Google Sheet must have a tab named "Helsinki" with these columns:

| Column Name | Description | Required |
|-------------|-------------|----------|
| ID | Unique company identifier | Yes |
| COMPANY | Company name | Yes |
| BRIDGE MESSAGE | Quick intro message | Yes |
| COMPANY IMAGE | Logo/image URL | Yes |
| OWNER / DRIVER | Owner's name | Yes |
| LANGUAGES - A | Primary language | Yes |
| LANGUAGES - B | Secondary language | Yes |
| RATE & SERVICES (I-IV) | Pricing tiers | Yes |
| VEHICLE MODEL | Fleet information | Yes |
| LICENSED | License status | Yes |
| COVERAGE | Service area | Yes |
| SERVICES | Service list | Yes |
| CUSTOM OFFERS | Special deals | Yes |
| AVAILABILITY | Operating hours | Yes |
| CONTACT METHOD | Preferred contact | Yes |
| THANK YOU MESSAGE | Closing message | Yes |

### First Run

```bash
# Start Redis (if local)
redis-server

# Start MongoDB (if local)
mongod

# Run the application
npm start

# You'll see QR code in terminal - scan with WhatsApp
```

---

## Configuration

### Google Sheets Credentials

#### Option 1: Base64 Environment Variable (Production)

```bash
# Encode your service account JSON
cat googlesheetAPI.json | base64 -w 0 > credentials.txt

# Add to .env
GOOGLE_SHEETS_CREDENTIALS=<paste_base64_string>
```

#### Option 2: Local JSON File (Development)

Place `googlesheetAPI.json` in the root directory:

```json
{
  "type": "service_account",
  "project_id": "your-project",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "service-account@project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

### Redis Configuration

The bot uses Redis for:
- **Session mapping** (phone number → session ID)
- **Distributed locks** (prevent race conditions)
- **Duplicate detection** (idempotency)
- **Rate limiting** (API protection)

### MongoDB Configuration

Used exclusively for WhatsApp authentication persistence. The bot stores session data using `LocalAuth` strategy to avoid frequent QR code scanning.

---

## Core Components

### 1. Express API Server (`index.js`)

**Purpose**: REST API for website integration

**Key Features**:
- Rate limiting (100 requests per 15 minutes)
- CORS enabled for all origins
- Health check endpoint
- Session initiation endpoint

**Endpoints**:
- `GET /` - Health check
- `POST /api/initiate-chat` - Create chat session

### 2. WhatsApp Bot (`bot.js`)

**Purpose**: Handles WhatsApp message processing

**Key Responsibilities**:
- WhatsApp authentication and connection
- Message routing and session matching
- Company data retrieval
- Response orchestration
- Duplicate prevention

**Event Handlers**:
```javascript
client.on('qr', ...)          // QR code for authentication
client.on('authenticated', ...)  // Success confirmation
client.on('ready', ...)       // Bot is operational
client.on('message', ...)     // Incoming message handler
```

### 3. Chat Routes (`src/api/chatRoutes.js`)

**Purpose**: API endpoints for chat initiation

#### POST `/api/initiate-chat`

**Request Body**:
```json
{
  "companyId": "C001",
  "imageUrl": "https://example.com/logo.png"
}
```

**Response**:
```json
{
  "message": "WhatsApp chat link generated successfully.",
  "waLink": "https://wa.me/358401234567?text=Hello...",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Session Data Stored**:
```javascript
{
  companyId: "C001",
  imageUrl: "https://...",
  timestamp: 1699632000000,
  sessionId: "uuid-v4",
  status: "pending"
}
```

### 4. Google Sheets Service (`src/services/googleSheetsService.js`)

**Purpose**: Fetch company information

**Functions**:

```javascript
// Get single company
const company = await getCompanyData('C001');

// Get all companies
const allCompanies = await getAllCompanies();
```

**Data Validation**: Ensures all required fields are present before returning data.

### 5. Temporary Storage Service (`src/services/tempStoreService.js`)

**Purpose**: Redis wrapper for session management

**Functions**:

```javascript
// Store data with TTL
await setTempData(key, value, ttlSeconds);

// Retrieve data
const data = await getTempData(key);

// Get all keys matching pattern
const keys = await getAllKeys('session_*');

// Mark user as fallback-replied
await markFallbackReplied(phoneNumber);
```

### 6. Helper Functions (`src/utils/helperFunctions.js`)

**Purpose**: Prevent race conditions and duplicates

```javascript
// Check if message already processed
const isDuplicate = await isDuplicateMessage(msgId);

// Try to acquire session lock
const locked = await acquireSessionLock(sessionId);

// Check if bridge message sent
const sent = await bridgeAlreadySent(sessionId);

// Prevent duplicate bot responses
await markBotResponseSent(sessionId);
```

---

## API Reference

### POST `/api/initiate-chat`

Generates a WhatsApp chat link for a specific company.

**Headers**:
```
Content-Type: application/json
```

**Request**:
```json
{
  "companyId": "C001",
  "imageUrl": "https://cdn.example.com/moving-company-logo.png"
}
```

**Response** (200 OK):
```json
{
  "message": "WhatsApp chat link generated successfully.",
  "waLink": "https://wa.me/358401234567?text=Hello%2C%20I%20am%20interested%20in%20your%20services.",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses**:

- **400 Bad Request**: Missing or invalid parameters
  ```json
  {
    "errors": [
      {
        "msg": "Company ID is required.",
        "param": "companyId",
        "location": "body"
      }
    ]
  }
  ```

- **500 Internal Server Error**: Server failure
  ```json
  {
    "message": "Failed to generate chat link. Please try again."
  }
  ```

**Rate Limiting**: 100 requests per 15 minutes per IP

---

### GET `/api/chat-redirect`

Validates session and redirects to WhatsApp.

**Query Parameters**:
- `sessionId` (required): UUID from initiate-chat response

**Example**:
```
GET /api/chat-redirect?sessionId=550e8400-e29b-41d4-a716-446655440000
```

**Response** (302 Redirect):
```
Location: https://wa.me/358401234567?text=Hello%2C%20I%20am%20interested...
```

**Error Responses**:
- **400**: Missing or invalid session ID
- **500**: Server error

---

### GET `/api/session-status/:sessionId`

Debug endpoint to check session data.

**Example**:
```
GET /api/session-status/550e8400-e29b-41d4-a716-446655440000
```

**Response** (200 OK):
```json
{
  "exists": true,
  "ageMinutes": 5,
  "data": {
    "companyId": "C001",
    "imageUrl": "https://...",
    "timestamp": 1699632000000,
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending"
  }
}
```

---

### GET `/`

Health check endpoint.

**Response** (200 OK):
```
WhatsApp Bot API is running!
```

---

## Bot Logic Flow

### 1. Session Initialization

```
Website → API: POST /initiate-chat
API → Redis: Store session data
API → Website: Return waLink + sessionId
Website → User: Display WhatsApp button
User → WhatsApp: Click link & send message
```

### 2. Message Processing

```
WhatsApp → Bot: Incoming message
Bot → Redis: Check if duplicate
Bot → Redis: Find session by phone
Bot → Redis: Acquire session lock
Bot → Google Sheets: Fetch company data
Bot → WhatsApp: Send bridge message
Bot → Redis: Mark bridge sent
[Wait 30 seconds]
Bot → WhatsApp: Send detailed response
Bot → Redis: Mark completed
```

### 3. Session Matching Logic

The bot uses a sophisticated multi-step approach to match incoming WhatsApp messages to sessions:

#### Step 1: Phone Number Mapping (Primary)

```javascript
// Check if phone number is already mapped to a session
const phoneSessionKey = `phone_session_${normalizedPhone}`;
const sessionId = await getTempData(phoneSessionKey);
```

#### Step 2: Recent Session Scan (Fallback)

```javascript
// Search all sessions created in last 10 minutes
const allSessions = await getAllKeys('session_*');
for (const session of allSessions) {
  if (sessionAge < 10 minutes && session.status === 'pending') {
    // Claim this session
    await acquireSessionLock(sessionId);
    await setTempData(phoneSessionKey, sessionId);
  }
}
```

#### Step 3: UUID Extraction (Legacy)

```javascript
// Look for UUID in message body (legacy support)
const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const match = messageBody.match(uuidRegex);
```

#### Step 4: Fallback Response

If no session matches, send generic response:
```
This is the official contact line for www.movingservicefinland.com.
Please visit our website to book and compare prices. Thanks!
```

---

## Data Storage

### Redis Key Patterns

| Key Pattern | Purpose | TTL | Example |
|-------------|---------|-----|---------|
| `session_{uuid}` | Session metadata | 10 min | `session_550e8400-...` |
| `phone_session_{phone}` | Phone→Session mapping | 10 min | `phone_session_358401234567` |
| `lock:{sessionId}` | Distributed lock | 60 sec | `lock:550e8400-...` |
| `msg:{msgId}` | Duplicate detection | 2 min | `msg:ABCD1234...` |
| `bridge_sent_{sessionId}` | Bridge message flag | 5 min | `bridge_sent_550e8400-...` |
| `bot_response_sent_{sessionId}` | Response flag | 1 hour | `bot_response_sent_550e8400-...` |
| `fallback_user_{phone}` | Generic reply flag | 24 hours | `fallback_user_358401234567` |
| `completed_user_{phone}_{companyId}` | Completion flag | 1 hour | `completed_user_358401234567_C001` |

### Session Status Lifecycle

```
pending → active → bridge_sending → bridge_sent → response_sent
```

**State Definitions**:

- **pending**: Created by API, waiting for WhatsApp message
- **active**: Claimed by incoming message, lock acquired
- **bridge_sending**: Currently sending quick intro message
- **bridge_sent**: Intro sent, waiting to send detailed response
- **response_sent**: Complete interaction, user marked as served

---

## Session Management

### Phone Number Normalization

All phone numbers are normalized to international format:

```javascript
function normalizePhoneNumber(phoneNumber) {
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Handle Finnish local format (starts with 0)
  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.substring(1);  // Note: Uses Nigerian code in current implementation
  }
  
  // Handle 10-digit numbers
  if (cleaned.length === 10) {
    cleaned = '234' + cleaned;
  }
  
  return cleaned;
}
```

**⚠️ Note**: Current implementation uses Finnish country code (358). Update this function for your desired country code

### Session Expiry

- **Pending sessions**: 10 minutes (600 seconds)
- **Active sessions**: Extended to 30 minutes (1800 seconds) after response
- **Phone mappings**: 10 minutes
- **Completion flags**: 1 hour (prevents repeated contacts to same company)

### Lock Mechanism

Distributed locks prevent race conditions when multiple messages arrive simultaneously:

```javascript
const acquired = await redisClient.set(
  `lock:${sessionId}`, 
  1, 
  { NX: true, EX: 60 }  // Only set if not exists, 60s expiry
);

if (!acquired) {
  console.log('Another process is handling this session');
  return;
}

// ... process message ...

await redisClient.del(`lock:${sessionId}`);  // Release lock
```

---

## Error Handling

### Graceful Degradation

The bot handles errors without crashing:

```javascript
try {
  const companyData = await getCompanyData(companyId);
} catch (error) {
  console.error('Failed to fetch company data:', error);
  await msg.reply('Sorry, cannot find company details. Please try again later.');
  await redisClient.del(`lock:${sessionId}`);
  return;
}
```

### Duplicate Prevention

Multiple safeguards prevent duplicate messages:

1. **Message ID tracking**: Each WhatsApp message has unique ID
2. **Bridge sent flag**: Prevents re-sending intro
3. **Response sent flag**: Prevents re-sending details
4. **Completion tracking**: Per-user, per-company cooldown

### Image Fallback

If company images fail to load, bot sends text-only messages:

```javascript
try {
  const media = new MessageMedia('image/jpeg', buffer.toString('base64'));
  await msg.reply(media, null, { caption: message });
} catch (err) {
  console.error('Image error, sending text only:', err);
  await msg.reply(message);  // Fallback to text
}
```

### Connection Recovery

WhatsApp client handles disconnections:

```javascript
client.on('disconnected', (reason) => {
  console.log('Client disconnected:', reason);
  // Client will attempt auto-reconnect
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failure:', msg);
  // Manual intervention required - scan QR code
});
```

---

## Deployment

### Docker Deployment

**Dockerfile**:
```dockerfile
FROM node:18-slim

# Install Chromium for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 8888

CMD ["node", "index.js"]
```

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  bot:
    build: .
    ports:
      - "8888:8888"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/whatsapp-bot
      - REDIS_URL=redis
      - REDIS_PORT=6379
    depends_on:
      - mongo
      - redis
    volumes:
      - ./data:/app/data

  mongo:
    image: mongo:6
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

### Railway Deployment

1. **Push to GitHub**
2. **Connect Railway to repository**
3. **Add environment variables** in Railway dashboard
4. **Configure services**:
   - Add MongoDB plugin
   - Add Redis plugin
   - Set `GOOGLE_SHEETS_CREDENTIALS` as base64

### PM2 Deployment (VPS)

```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start index.js --name whatsapp-bot

# Start background bot process
pm2 start botss.js --name whatsapp-bot-listener

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

**ecosystem.config.js**:
```javascript
module.exports = {
  apps: [
    {
      name: 'api-server',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'whatsapp-bot',
      script: 'botss.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

---

## Troubleshooting

### Common Issues

#### 1. QR Code Keeps Appearing

**Problem**: Bot requests QR code on every restart

**Causes**:
- MongoDB session not persisting
- Session collection empty
- Wrong `clientId` in LocalAuth

**Solutions**:
```bash
# Check MongoDB collections
use whatsapp-bot
show collections

# Look for: whatsapp-RemoteAuth-whatsapp_msf_bot.chunks
# and: whatsapp-RemoteAuth-whatsapp_msf_bot.files

# If missing, scan QR code once
# Session should persist after successful authentication
```

#### 2. "Session Not Found" Errors

**Problem**: Users get "Invalid or expired session" when clicking WhatsApp link

**Causes**:
- Session expired (>10 minutes)
- Redis connection lost
- Clock skew between servers

**Solutions**:
```javascript
// Increase session TTL in chatRoutes.js
await setTempData(createSessionKey(sessionId), sessionData, 900); // 15 minutes

// Check Redis connection
redis-cli ping
// Should return: PONG
```

#### 3. Duplicate Messages

**Problem**: Users receive multiple identical messages

**Causes**:
- Lock mechanism failing
- Redis keys not expiring
- Race conditions

**Solutions**:
```bash
# Clear stuck locks manually
redis-cli KEYS "lock:*" | xargs redis-cli DEL

# Check for orphaned flags
redis-cli KEYS "bridge_sent_*"
redis-cli KEYS "bot_response_sent_*"
```

#### 4. Company Data Not Loading

**Problem**: Bot says "Cannot find company details"

**Causes**:
- Google Sheets API quota exceeded
- Invalid credentials
- Sheet structure changed

**Solutions**:
```javascript
// Test Google Sheets connection
const { getAllCompanies } = require('./src/services/googleSheetsService.js');
getAllCompanies().then(companies => {
  console.log(`Found ${companies.length} companies`);
  console.log(companies[0]); // Check structure
});
```

#### 5. Puppeteer Crashes

**Problem**: WhatsApp client fails to initialize

**Causes**:
- Missing Chromium dependencies
- Insufficient memory
- Wrong executable path

**Solutions**:
```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get install -y \
  chromium-browser \
  ca-certificates \
  fonts-liberation \
  libnss3 \
  libxss1

# Check memory
free -h
# Recommended: At least 1GB available

# Verify executable path
which chromium-browser
# Update PUPPETEER_EXECUTABLE_PATH in .env
```

---

### Debug Mode

Enable verbose logging:

```javascript
// Add to botss.js
client.on('message', async (msg) => {
  console.log('=== DEBUG START ===');
  console.log('From:', msg.from);
  console.log('Body:', msg.body);
  console.log('Timestamp:', msg.timestamp);
  console.log('=== DEBUG END ===');
  // ... rest of handler
});
```

Check Redis keys in real-time:

```bash
# Monitor all Redis operations
redis-cli MONITOR

# Or filter specific patterns
redis-cli --scan --pattern 'session_*'
```

---

## Best Practices

### 1. Security

**Environment Variables**:
```bash
# Never commit .env files
echo ".env" >> .gitignore

# Use strong Redis passwords
REDIS_PASSWORD=$(openssl rand -base64 32)

# Rotate Google service account keys quarterly
```

**API Security**:
```javascript
// Add authentication middleware
const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/api/initiate-chat', apiKeyMiddleware);
```

### 2. Performance

**Connection Pooling**:
```javascript
// MongoDB connection options
mongoose.connect(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});
```

**Redis Pipeline**:
```javascript
// Batch multiple Redis operations
const pipeline = redisClient.pipeline();
pipeline.set('key1', 'value1');
pipeline.set('key2', 'value2');
pipeline.set('key3', 'value3');
await pipeline.exec();
```

### 3. Monitoring

**Health Checks**:
```javascript
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: Date.now(),
    services: {}
  };

  // Check Redis
  try {
    await redisClient.ping();
    health.services.redis = 'connected';
  } catch (err) {
    health.services.redis = 'disconnected';
    health.status = 'degraded';
  }

  // Check MongoDB
  health.services.mongodb = mongoose.connection.readyState === 1 
    ? 'connected' 
    : 'disconnected';

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});
```

**Logging**:
```javascript
// Use winston for structured logging
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// In production, send logs to external service
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}
```

### 4. Testing

**Unit Tests**:
```bash
# Run existing tests
npm test

# Watch mode for development
npm test -- --watch
```

**Integration Tests**:
```javascript
// Test API endpoint
const request = require('supertest');
const app = require('./index.js');

describe('POST /api/initiate-chat', () => {
  it('should create session and return WhatsApp link', async () => {
    const response = await request(app)
      .post('/api/initiate-chat')
      .send({
        companyId: 'C001',
        imageUrl: 'https://example.com/logo.png'
      })
      .expect(200);

    expect(response.body).toHaveProperty('waLink');
    expect(response.body).toHaveProperty('sessionId');
  });
});
```

### 5. Scalability

**Horizontal Scaling**:
- Use Redis for session sharing across instances
- Deploy multiple bot instances with load balancer
- Consider message queue (e.g., RabbitMQ) for high volume

**Database Optimization**:
```javascript
// Index frequently queried fields
await mongoose.connection.collection('sessions').createIndex({ 
  sessionId: 1 
}, { 
  expireAfterSeconds: 600 
});
```

---

## Maintenance

### Regular Tasks

**Weekly**:
- Review error logs for patterns
- Check Redis memory usage: `redis-cli INFO memory`
- Monitor MongoDB disk space
- Verify Google Sheets API quota

**Monthly**:
- Update dependencies: `npm outdated` → `npm update`
- Review and archive old logs
- Test disaster recovery procedures
- Audit environment variables

**Quarterly**:
- Rotate Google service account keys
- Update SSL certificates (if self-hosted)
- Performance audit and optimization
- Security patch review

---

## Support & Contributing

### Getting Help

1. **Check logs**:
   ```bash
   # PM2 logs
   pm2 logs whatsapp-bot --lines 100
   
   # Docker logs
   docker logs whatsapp-bot --tail 100 -f
   ```

2. **Test individual components**:
   ```bash
   # Test Google Sheets connection
   node -e "require('./src/services/googleSheetsService.js').getAllCompanies().then(console.log)"
   
   # Test Redis connection
   redis-cli ping
   ```

3. **Enable debug mode**:
   ```env
   DEBUG=whatsapp-web.js:*
   ```

### Reporting Issues

When reporting bugs, include:
- Node.js version: `node --version`
- Error logs (last 50 lines)
- Environment (Docker, Railway, VPS, etc.)
- Steps to reproduce
- Expected vs actual behavior

---

## License

This project is proprietary software for Moving Service Finland. Unauthorized use, distribution, or modification is prohibited.

---

## Changelog

### Version 1.0.0 (Current)
- Initial release
- WhatsApp integration with LocalAuth
- Redis session management
- Google Sheets integration
- Multi-company support
- Duplicate prevention system
- Rate limiting
- Image message support

---

**Last Updated**: November 2025  
**Maintained By**: Moving Service Finland Development Team