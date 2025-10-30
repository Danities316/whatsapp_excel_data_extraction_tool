# Final, simple Dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (will be much faster now)
RUN npm install

# Copy application files
COPY . .

# Expose the API port
EXPOSE 8888

# Define the start command
CMD [ "npm", "run", "start" ]