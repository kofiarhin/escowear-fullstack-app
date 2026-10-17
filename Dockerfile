# Build React separately so the running app contains only server dependencies.
FROM node:20-bookworm-slim AS frontend
WORKDIR /app/client
COPY client/package.json ./
# client/package-lock.json is currently empty; npm ci would fail.
RUN npm install --no-package-lock --no-audit --no-fund
COPY client/ ./
ENV CI=false
ENV NODE_OPTIONS=--max-old-space-size=1536
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
