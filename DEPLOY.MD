Deployment Guide

\# Deployment Guide

# 1\. Prerequisites

- A server running a Linux distribution (e.g., Ubuntu, CentOS).
- Node.js (version 16 or later) and npm installed.
- Access to your application's code repository.
- A running Redis instance with network access for the application.

\---

# 2\. Environment Configuration

The application uses a \`.env\` file for all production-specific configurations.

\*\*Do NOT commit this file to your repository.\*\*

## Create a new \`.env\` file on the production server with the following variables

\# Core App

NODE_ENV=production

PORT=80

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

3\. Application Setup

Clone the Repository

bash

Copy code

git clone &lt;your_repo_url&gt;

cd &lt;your_project_directory&gt;

Install Dependencies

bash

Copy code

npm install --production

This installs only the necessary packages, optimized for the production environment.

Run a Security Audit

bash

Copy code

npm audit

Review and address any critical or high-severity vulnerabilities before proceeding.

4\. Running the Application with a Process Manager

## We will use PM2 to manage the application process. PM2 ensures

The application runs 24/7

Automatic restarts on crashes

Utilization of multiple CPU cores for better performance

Install PM2 Globally

bash

Copy code

npm install -g pm2

Start the Application

## Navigate to your project root and start the app with PM2

bash

Copy code

pm2 start index.js --name "whatsapp-bot-api"

This starts the app in the background and names the process whatsapp-bot-api.

Manage the Process

## Check status

bash

Copy code

pm2 status

## View logs

bash

Copy code

pm2 logs whatsapp-bot-api

## Restart

bash

Copy code

pm2 restart whatsapp-bot-api

Configure Startup on Boot

## To ensure the app starts after a reboot

bash

Copy code

pm2 startup

pm2 save

5\. Post-Deployment

Logging: All console.log and console.error outputs are handled by PM2.

## View them with

bash

Copy code

pm2 logs

## Monitoring Use PM2’s built-in monitoring

bash

Copy code

pm2 monit
