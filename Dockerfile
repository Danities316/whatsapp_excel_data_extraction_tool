# STEP 1: Use a reliable base image
# Node 22-slim is Debian-based and minimal, but allows us to add packages.
FROM node:22-slim

# STEP 2: Install required system packages for Puppeteer/Chromium
# These packages include the missing libgobject-2.0-0 (part of libglib2.0-0)
# and all other necessary headless dependencies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    # The essential packages for headless browsing:
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libxss1 \
    libdbus-1-3 \
    # Clean up package lists to keep image size down
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# STEP 3: Set working directory
WORKDIR /app

# STEP 4: Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# STEP 5: Copy application files
COPY . .

# STEP 6: Set the Puppeteer executable path (crucial fix)
# This forces whatsapp-web.js (which uses puppeteer-core) to use the
# system-installed Chromium that has all dependencies.
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"

# STEP 7: Set the default command to run both API and Bot
# We use the 'start' script defined in package.json
CMD [ "npm", "start" ]

# Expose the port (8888 from your index.js)
EXPOSE 8888