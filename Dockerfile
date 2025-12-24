# Use Node.js 20 with Debian (slim version for smaller size)
FROM node:20-slim

# Install Python 3 and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Install Python dependencies (edge-tts)
RUN pip3 install --break-system-packages edge-tts

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (Railway will set PORT env var)
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start"]

