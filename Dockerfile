# Use a stable Node.js image with root privileges for apt-get
FROM node:20-slim

# Set the working directory for the application
WORKDIR /app

# Install necessary system dependencies for Chromium and Node-Sass/Gyp (optional, but good practice)
# We install the Chromium browser package explicitly here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libfontconfig1 \
    curl \
    git \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# CRITICAL: Set the Puppeteer executable path to the system-installed Chromium
# This variable must be set inside the container environment.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PUPPETEER_EXECUTABLE_PATH /usr/bin/chromium

# Expose the port your Express server runs on (from index.js, default 8888)
EXPOSE 8888

# Define the command to run your application when the container starts
CMD [ "npm", "run", "start" ]