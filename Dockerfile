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
# Draft policies stay hidden unless explicitly published after legal review.
ARG REACT_APP_POLICIES_STATUS=hidden
ENV REACT_APP_POLICIES_STATUS=${REACT_APP_POLICIES_STATUS}
COPY client/ ./
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/ ./server/
COPY client/scripts/check-policies.cjs ./client/scripts/check-policies.cjs
COPY client/src/policies/review.json ./client/src/policies/review.json
COPY --from=frontend /app/client/build ./client/build
# Private payment-proof store (mounted as a named volume); owned by the app user only.
RUN mkdir -p /app/data/payment-proofs && chown -R node:node /app/data && chmod 700 /app/data /app/data/payment-proofs
USER node
EXPOSE 5000
CMD ["node", "server/server.js"]
