FROM node:20-bookworm-slim AS frontend
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
ENV CI=false
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/ ./server/
COPY --from=frontend /app/client/build ./client/build
USER node
EXPOSE 5000
CMD ["node", "server/server.js"]
