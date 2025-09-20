WhatsApp Bot API

WhatsApp Bot API

# Project Overview

A Node.js Express API that serves as the backend for a WhatsApp bot. It is designed to automate the process of initiating conversations with users based on data stored in a Google Sheet. The application uses Redis for temporary session data and MongoDB for persistent WhatsApp session management.

# Features

Chat Initiation: Generates a pre-filled WhatsApp chat link for users, streamlining the start of a conversation.

Dynamic Content: Fetches company-specific data and a relevant image URL from a Google Sheet.

Session Management: Stores temporary session data in Redis for a limited time to correlate user actions and chat data.

Robust Architecture: Built on a modular Express.js framework with dedicated services for Google Sheets, Redis, and API routes.

Security: Includes middleware for rate limiting and CORS to secure the API endpoints.

# Prerequisites

## To run this project, you will need

Node.js (version 16 or higher)

npm (Node Package Manager)

A running Redis instance

A running MongoDB instance

Access to a Google Sheet with company data

# Installation

## Clone the repository

### Bash

git clone &lt;your_repo_url&gt;

cd &lt;your_project_directory&gt;

## Install dependencies

### Bash

npm install

## Create the environment file

Create a .env file in the root of the project to store your configurations. Do NOT commit this file to your repository.

### Bash

touch .env

## Add the following content to your .env file, replacing the placeholder values with your actual credentials

### Ini, TOML

\# Core App

NODE_ENV=development

PORT=8888

BOT_PHONE=your_bot_phone_number

\# Google Sheets API

GOOGLE_SHEET_ID=your_google_sheet_id

GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email

GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="your_private_key"

\# Redis

REDIS_URL=your_redis_host

REDIS_PORT=your_redis_port

REDIS_USERNAME=your_redis_username

REDIS_PASSWORD=your_redis_password

\# MongoDB

MONGODB_URI=your_mongodb_connection_string

## Run the application

### Bash

node index.js

Your server will now be running at <http://localhost:8888>.

# API Endpoints

## The API exposes the following endpoints

## POST /api/initiate-chat

### Initiates a WhatsApp chat link with a pre-filled message

## Request Body

companyId: The unique ID of the company from your Google Sheet. (required)

imageUrl: The URL of the image to be sent. (required)

## Example Request (using curl)

### Bash

curl -X POST <http://localhost:8888/api/initiate-chat> -H "Content-Type: application/json" -d '{

"companyId": "A1",

"imageUrl": "<https://example.com/image.jpg>"

}'

## Example Success Response

### JSON

{

"message": "WhatsApp chat link generated successfully.",

"waLink": "<https://wa.me/2348184244082?text=Hello%2C%20I%20am%20interested>...",

"sessionId": "12345678-abcd-4efg-9hij-klmnopqrstuv"

}

## GET /api/session-status/:sessionId

An optional endpoint to check the status of a temporary session.

## URL Parameter

sessionId: The ID of the session to check.

## GET /

A simple health check endpoint.

## Example Response

WhatsApp Bot API is running!

# Deployment

For production deployment instructions, including how to use PM2 for process management, please refer to the Deployment Guide.docx file.