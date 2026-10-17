# Build React separately so the running app contains only server dependencies.
FROM node:20-bookworm-slim AS frontend-deps
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund

FROM frontend-deps AS frontend-test
COPY client/ ./
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN CI=true npm test -- --watchAll=false --runInBand

FROM frontend-deps AS frontend
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
