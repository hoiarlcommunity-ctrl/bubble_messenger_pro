FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /app/data/uploads && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
