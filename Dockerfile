# Build React separately so the running app contains only server dependencies.
FROM node:20-bookworm-slim AS frontend-deps
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund

FROM frontend-deps AS frontend-test
COPY client/ ./
RUN npm run lint
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
# The server refuses to start if its runtime policy status differs from the site build's.
ARG REACT_APP_POLICIES_STATUS=hidden
ENV ESCOWEAR_BUILD_POLICIES_STATUS=${REACT_APP_POLICIES_STATUS}
WORKDIR /app
# COPY keeps host file modes, and Beast builds from an owner-only checkout (600/700).
# Normalise to root-owned, world-readable and not writable by the node user.
COPY --chmod=u=rwX,go=rX package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chmod=u=rwX,go=rX server/ ./server/
COPY --chmod=u=rwX,go=rX client/scripts/check-policies.cjs ./client/scripts/check-policies.cjs
COPY --chmod=u=rwX,go=rX client/src/policies/review.json ./client/src/policies/review.json
COPY --chmod=u=rwX,go=rX client/src/constants/productColors.json ./client/src/constants/productColors.json
COPY --chmod=u=rwX,go=rX --from=frontend /app/client/build ./client/build
# Private payment-proof store (mounted as a named volume); owned by the app user only.
RUN mkdir -p /app/data/payment-proofs && chown -R node:node /app/data && chmod 700 /app/data /app/data/payment-proofs
USER node
EXPOSE 5000
CMD ["node", "server/server.js"]
