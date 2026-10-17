# EscoWear---FullStack-App

# A simple Fullstack application using Express Js for backend and React Js for Frontend

# [Live Demo](https://calm-peak-91849.herokuapp.com/)

## Banging Prices sneaker importer

The importer reads sneaker products from Banging Prices and prepares insert-only
Escowear product documents. It requires these variables in the root `.env`:

- `BANGING_PRICES_MONGO_URI` must select the `price_pulse_test` database.
- `ESCOWEAR_MONGO_URI` must select the `escowear-sneaker-import-test` database.

URI values and credentials are never printed. The importer rejects unexpected
database names before reading product collections.

Run the required read-only preview from PowerShell:

```powershell
npm.cmd run import:sneakers -- --dry-run
```

The preview checks both connections, reports sneaker and duplicate counts, and
does not create collections or indexes. Do not run the write mode until the
dry-run output has been reviewed and import approval has been given.

After explicit approval, the insert-only mode is:

```powershell
npm.cmd run import:sneakers -- --execute
```

The write mode creates a unique source-identity index and inserts only products
whose Banging Prices canonical keys are not already present. It does not update
or delete existing Escowear products.

Run the focused importer tests with:

```powershell
npm.cmd run test:importer
```

## Product API and local test database

The Express application reads products from the MongoDB database selected by
`ESCOWEAR_MONGO_URI`. For local sneaker integration, that URI must select
`escowear-sneaker-import-test`; the server refuses to start with any other
database name and never prints the URI or credentials.

Start the API and React application with:

```powershell
npm.cmd run dev
```

Available product endpoints:

- `GET /api/products?page=1&limit=24` returns a paginated product envelope.
- `GET /api/products?category=shoes` filters by exact product category.
- `GET /api/products?search=nike` searches names, brands, retailers, and source categories.
- `GET /api/products/:id` returns one product or a `404` response.

Run the focused backend and frontend tests with:

```powershell
npm.cmd run test:server
$env:CI='true'; npm.cmd test --prefix client -- --watchAll=false
```
