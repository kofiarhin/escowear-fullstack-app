# Escowear React storefront

The frontend for [Escowear](https://escowear.com), a UK-to-Ghana sneaker-store MVP.

The React app is in `client/`; the Express API is in `../server/`. In development the React server proxies API requests to `http://localhost:5000`. In production, Express serves the compiled React app and API from the same origin behind the Beast VPS's Nginx and HTTPS.

## Run locally

From the repository root:

```bash
npm ci
npm ci --prefix client
npm run dev
```

Then open `http://localhost:3000`. The API requires a private root `.env` with `ESCOWEAR_MONGO_URI` selecting `escowear-sneaker-import-test`. See [the root README](../README.md).

## Verify

```bash
CI=true npm test --prefix client -- --watchAll=false
npm run build --prefix client
```

The frontend test suite had four passing tests during Beast deployment preparation in October 2026. That does not replace live browser checkout verification.

## Routes and behaviour

- `/`: UK-to-Ghana sneakers homepage.
- `/store`: paginated catalogue with search and product cards.
- `/details/:id`: individual product detail route.
- Account, cart and other store views use React Router; these need full live buyer-flow testing.

The public catalogue was observed showing sneaker images, available sizes and prices in GBP. For deployment, see [Beast operations guide](../deploy/beast/README.md). Do not modify the production application just to update frontend documentation.
