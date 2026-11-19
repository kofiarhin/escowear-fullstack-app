# Admin-managed homepage Classics (IDE-149)

Admins choose the homepage "The Classics" cards at `/admin/products/classics`. The storefront design is unchanged.

## Behaviour

- 0–6 cards. Each card has a **title** (1–40 chars), a **search term** (1–60 chars) and one published **representative product**.
- A card links to `/store?search=<encoded search term>` and shows the product's **cover image** (`image`, falling back to the first `images` entry). Cards never link to product details.
- A product can back only one card (duplicates are rejected).
- Before the first save the homepage shows the built-in six (Air Force 1, Dunk, Air Max, Samba, Spezial, Campus), each borrowing the newest published product matching its term that no earlier default uses. A default with no match is hidden on the homepage and shown in admin as needing a product. After a save the homepage shows exactly the saved cards, including none ("New classics are on the way").
- A saved card whose product becomes a draft or is deleted is hidden publicly (never back-filled) and flagged in admin.
- The section's "Shop the classics" button opens `/store` (cards can span brands); it is hidden when there are no cards.
- If `/api/classics` fails, the homepage falls back to the built-in links with the default image. The header's "Classic silhouettes" menu stays static.

## Data

Singleton `homepageClassics` document `_id: "homepage"`: `{ entries: [{ title, searchTerm, productId }], version, updatedBy }`. Product details are resolved on every read; nothing is copied. Featured Sneakers data is separate and untouched.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/api/classics` | Public. `{ items: [{ title, searchTerm, product: { _id, name, image } \| null }], configured, version }` |
| GET | `/api/admin/classics` | Admin. `{ item: { configured, entries, version, updatedAt, products }, warnings: [{ productId, reason: "draft" \| "missing" }] }` |
| PUT | `/api/admin/classics` | Admin. Body `{ entries, expectedVersion }` |

PUT responses: `400 INVALID_CLASSICS_SELECTION` (with per-field `fields`, e.g. `entries.0.title`), `422 INELIGIBLE_CLASSICS_PRODUCTS` (draft/missing ids in `unavailable`), `409 STALE_CLASSICS_SELECTION` (version changed), `401/403` for non-admins. Rejected requests never modify the stored selection. Admin routes use the existing admin authentication, role check and rate limiter.

## Tests

- `server/tests/classics.test.js`: defaults, ordering, trimming, empty selection, draft/missing handling, auth, validation, 422, versioning/concurrency, Featured isolation, safe errors.
- `client/src/Pages/Home/Home.page.test.js`: single request, saved order and links, six-card cap, empty state, failure fallback, image fallback, abort on unmount.
- `client/src/Pages/AdminClassics/AdminClassics.test.js`: navigation, editing, add/replace/reorder/remove/save, six-card limit, saving defaults, warnings, stale save, server and network errors, load failure and 403.
