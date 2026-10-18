# Escowear

**Live MVP:** https://escowear.com  
**Shop:** https://escowear.com/store

Escowear is a UK-to-Ghana sneaker storefront built with **React**, **Express/Node.js** and **MongoDB**. Shoppers can browse, search and view sneaker details. The public site is deployed on the **Beast VPS** using Docker Compose, with host Nginx and Let's Encrypt HTTPS.

## Current state (October 2026)

- The owner verified the HTTPS homepage and shop in a browser. The shop displayed sneaker images, GBP prices and available sizes.
- Beast's Codex deployment report confirmed a healthy `escowear-web-1` container, working product API/images/health checks, and successful HTTPS configuration for `escowear.com` and `www.escowear.com`.
- The application connects to the existing MongoDB database `escowear-sneaker-import-test`. At launch, read-only checks found **3,258 products**.
- Automated checks reported **4 frontend tests** and **6 backend tests** passing. Auth/order behavior passed **isolated in-memory tests**, not real customer checkout testing.
- **Still to verify in-browser:** individual product detail pages, registration/login, cart, and complete order/checkout journey. A database backup was intentionally deferred for this MVP.

These are recorded deployment observations, not a guarantee of current service availability.

## Project structure

| Path | Purpose |
| --- | --- |
| `client/` | React storefront |
| `server/` | Express API, models, database connection and importer |
| `Dockerfile` | Multi-stage production container and frontend test stage |
| `compose.yaml` | Escowear Compose service, resource limits and localhost port |
| `deploy/beast/` | Release overlay, Nginx templates, smoke tests, operations guide and reports |
| `DEPLOY-BEAST.md` | Short production operations checklist |

## Local development

Requires Node.js, npm and a MongoDB URI selecting `escowear-sneaker-import-test`.

```bash
npm ci
npm ci --prefix client
```

Create a private **root** `.env` (never commit it):

```dotenv
ESCOWEAR_MONGO_URI=<private MongoDB URI ending in /escowear-sneaker-import-test>
JWT_SECRET=<strong random secret>
PORT=5000
NODE_ENV=development
```

`JWT_SECRET` is required in production. The database connection refuses to use a database with a different name.

Run the backend and frontend development servers:

```bash
npm run dev
```

React development server: `http://localhost:3000`; backend: `http://localhost:5000`.

### Tests

```bash
npm run test:server
CI=true npm test --prefix client -- --watchAll=false
```

For Windows PowerShell, set `$env:CI='true'` before the frontend command.

## Product API

- `GET /health` — application/database readiness
- `GET /api/products?page=1&limit=24` — paginated product catalogue
- `GET /api/products?search=nike` — search sneaker name, brand and related fields
- `GET /api/products?category=trainers` — category filter (the stored category must match)
- `GET /api/products/:id` — one product

Shop navigation uses `/store`, without a hard-coded `category=shoes` filter. The storefront normalizes legacy `category=shoes` links so the catalogue still appears.

## Deployment on Beast

The deployed setup is:

```text
escowear.com / www.escowear.com
        -> Namecheap DNS
        -> Beast host Nginx + Let's Encrypt HTTPS
        -> Docker Compose service escowear-web-1
        -> 127.0.0.1:5080 (Express serves React and /api)
        -> MongoDB: escowear-sneaker-import-test
```

Runtime Compose limits: **512 MiB RAM**, **1 CPU**, **128 processes**. The application port is bound to localhost, not exposed publicly. Other Beast applications have independent services.

**Do not redeploy simply because documentation changes.** For safe checks, release procedures, rollback and evidence, read [DEPLOY-BEAST.md](DEPLOY-BEAST.md), [Beast operations guide](deploy/beast/README.md), and [initial preparation report](deploy/beast/REPORT.md).

### Production safety

Keep `.env` private (mode `600` on Beast). Never commit or paste MongoDB credentials or JWT secrets. Verify database connectivity and the running image before making changes. Production Nginx, DNS, Docker startup, certificates, and database writes require owner approval. **A MongoDB backup/recovery plan was not verified at MVP launch** and remains a risk to address.

## Sneaker importer (separate, approval-gated workflow)

The importer reads sneakers from Banging Prices and prepares insert-only documents. It needs both:

- `BANGING_PRICES_MONGO_URI` selecting `price_pulse_test`;
- `ESCOWEAR_MONGO_URI` selecting `escowear-sneaker-import-test`.

Always preview first:

```bash
npm run import:sneakers -- --dry-run
npm run test:importer
```

Only after reviewing the preview and obtaining explicit data-write approval:

```bash
npm run import:sneakers -- --execute
```

The importer inserts only unseen canonical product keys; it does not update or delete existing products. Never run it as part of routine deployment.
