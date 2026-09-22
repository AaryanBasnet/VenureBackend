FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only, exactly as locked
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code (.dockerignore keeps secrets, tests and uploads out)
COPY --chown=node:node . .

# Never run the app as root
USER node

EXPOSE 5051

CMD ["node", "server.js"]
