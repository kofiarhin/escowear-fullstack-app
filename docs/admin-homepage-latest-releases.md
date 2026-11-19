# Admin-managed homepage Latest Releases (IDE-151)

Admins choose the homepage "Latest releases" products at `/admin/products/latest-releases` (sidebar: **Latest releases**; Products page: **Manage Latest Releases**). The storefront design is unchanged: cards use the shared `Product` component, so images, prices, sizes, wishlist and `/details/:id` links behave exactly as before.

## Behaviour

- 0–8 published products, in the saved order. A product can appear only once (it may also appear in Featured Sneakers or back a Classics card; the three selections are independent).
- Before the first save the homepage shows the four newest published products (`createdAt` desc, `_id` desc; drafts excluded), the same as the catalogue's first page. The admin page shows these as unsaved defaults; saving them as they are pins them.
- After a save the homepage shows exactly the saved products. New catalogue products are never appended automatically. An empty selection shows "New releases are on the way".
- A saved product that becomes a draft or is deleted is hidden publicly (never back-filled) and flagged in admin with a Remove/Replace prompt.
- Admin can search, add, replace (keeps the slot position), move up/down, remove, preview, discard and explicitly save. Unsaved changes trigger the browser leave warning.
- The header meta reads "Pulled directly from the Escowear catalogue" before the first save and "Hand-picked from the Escowear catalogue" once a selection is saved. "See every release" still opens `/store`.
- If `/api/latest-releases` fails, only this section shows an error with **Try again**; Featured and the Classics are unaffected.

## Data

Singleton `homepageLatestReleases` document `_id: "homepage"`: `{ productIds, version, updatedBy }` plus timestamps. Product details are resolved on every read; nothing is copied. No migration is needed: until the document exists, the default applies.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/api/latest-releases` | Public. `{ items: [product], configured, version }` (published products only) |
| GET | `/api/admin/latest-releases` | Admin. `{ item: { configured, productIds, version, updatedAt, products }, warnings: [{ productId, reason: "draft" \| "missing" }] }` |
| PUT | `/api/admin/latest-releases` | Admin. Body `{ productIds, expectedVersion }` (`expectedVersion: 0` for the first save) |

PUT responses: `400 INVALID_LATEST_RELEASES_SELECTION` (with `fields`), `422 INELIGIBLE_LATEST_RELEASES_PRODUCTS` (draft/missing ids in `unavailable`), `409 STALE_LATEST_RELEASES_SELECTION` (version changed), `401/403` for non-admins. Rejected requests never modify the stored selection. Admin routes use the existing admin authentication, role check and rate limiter.

## Tests

- `server/tests/latestReleases.test.js`: newest-four default, 8-product order, pinning defaults, empty selection, draft/missing handling, auth, validation, 422, versioning/concurrency, Featured/Classics independence, safe errors.
- `server/tests/realDb.latestReleases.test.js`: compare-and-set on a real (throwaway) MongoDB; opt-in via `npm run test:realdb`.
- `client/src/Pages/Home/Home.page.test.js`: default and saved order, 8-card cap, single card, empty state, independent failure/retry, abort on unmount.
- `client/src/Pages/AdminLatestReleases/AdminLatestReleases.test.js`: navigation, defaults, search/add/replace/reorder/remove/save, 8-slot limit, empty save, warnings, 422, stale save, server/network/search errors, load failure and 403.
