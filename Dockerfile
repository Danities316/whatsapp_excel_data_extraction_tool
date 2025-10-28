# STEP 1: Use a reliable base image
# Playwright images include Chromium and are compatible with puppeteer when you point to the Chromium executable.
FROM mcr.microsoft.com/playwright:foca

# Create app directory
WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker cache for deps
COPY package*.json ./

# Install dependencies (this will also let playwright image keep browsers)
RUN npm ci --unsafe-perm

# STEP 5: Copy application files
COPY . .

# STEP 6: Set the Puppeteer executable path (crucial fix)
# This forces whatsapp-web.js (which uses puppeteer-core) to use the
# system-installed Chromium that has all dependencies.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# STEP 7: Set the default command to run both API and Bot
# We use the 'start' script defined in package.json
CMD [ "npm", "start" ]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD curl -f http://localhost:8888/ || exit 1

# Expose the port (8888 from your index.js)
EXPOSE 8888