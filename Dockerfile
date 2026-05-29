FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install dependencies (use cached layer)
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Set production environment
ENV NODE_ENV=production

# Expose application port
EXPOSE 5051

# Start the server
CMD ["node", "server.js"]


