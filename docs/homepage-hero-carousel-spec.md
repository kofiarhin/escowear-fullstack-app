# Escowear — Database-Driven Homepage Hero Carousel

**Status:** Implementation specification; not implemented  
**Date:** 5 November 2026  
**Repository:** `kofiarhin/escowear-fullstack-app`  
**Inspected branch:** `master` (head `b64b0c0b0d84fed401ccf0d9ea1dd3542df54b60`)  
**Scope:** React storefront + Express API + MongoDB + existing admin authentication. No production rollout or data changes included.

## 1. Outcome

Replace the homepage's current static, two-column sneaker hero with a responsive, full-bleed, cinematic carousel inspired by premium sneaker storefronts. Its content comes from a separate MongoDB `heroSlides` collection referencing existing catalogue products. The owner selects products, writes short headlines and optionally descriptions, orders slides and publishes/unpublishes them through an authenticated admin page.

Each slide displays **one fixed CTA, “Shop Now”**, supplied by React (never editable or stored), linking to the selected Escowear product detail route `/details/:id`. No external retailer checkout and no direct purchase on the hero.

The rest of the homepage—category rail, featured products, latest releases, how it works, and about—continues to work unchanged.

### Confirmed product decisions

- Full-width dark sneaker imagery, bold white overlaid headline and fixed CTA.
- Mobile image-first layout: text overlaid in the **bottom-left of the same image**, not stacked beneath it. A dark lower gradient ensures readability and the shoe should occupy the upper region.
- Cinematic crossfade, subtle image scale/parallax, staggered text reveal; roughly six seconds per slide, roughly 800 ms transition.
- Admin chooses products and headlines. Description is optional. Desktop/mobile creative images may be supplied when available; catalogue product image is the fallback.
- Carousel data lives in MongoDB, not a hardcoded list.
- Public hero endpoint is separate from the shop catalogue endpoint; hero reads never change catalogue pagination.
- No admin-editable CTA text or CTA destination.

## 2. Current codebase evidence (verified in `master`)

| Existing file | Observed behavior | Impact |
| --- | --- | --- |
| `client/src/Pages/Home/Home.page.js` | `sneaker-hero` contains static copy, static sneaker asset and a `/store` CTA. Page separately dispatches `getProducts({ limit: 8, page: 1 })`. | Replace **only** hero markup; keep product-grid fetch and other sections intact. |
| `client/src/Pages/Home/home.styles.css` | Desktop two-column grid; at <=760px the media moves above the text, each in its own block. | Remove/replace only hero-specific rules; preserve shared `.button`, `.eyebrow`, category, grids, etc. |
| `client/src/index.styles.css` | Existing Archivo Black/Barlow typography, `--ease-out`, 320px minimum width and reduced-motion global rules. | Reuse existing tokens and honor reduced-motion settings. |
| `client/src/App.js`, `client/src/Pages/index.js` | React Router v6; admin routes exist for `/admin/orders`; product details at `/details/:id`. | Add `/admin/hero-slides` page and export. Do not change product paths. |
| `client/src/Pages/AdminOrders/AdminOrders.page.js` | Exports `AdminGate`; uses current Redux user and shared `apiRequest`/`authHeader`. | Reuse admin gate, auth and existing admin styling conventions. |
| `client/src/components/Header/Header.component.js` | Admin users get an “Admin” link to orders. | Offer access to hero management without removing orders access. |
| `client/src/utils/api.js` | `apiRequest` uses JSON and `authHeader` sends a bearer token. | Reuse for admin CRUD; public hero may use plain fetch or helper. |
| `client/src/utils/product.js` | `getProductImage` picks `image`, then first `images`, then a local image path/default. | Mirror **safe** fallback semantics for hero images. |
| `server/Models/Product.model.js` | Products hold `name`/`title`, `image`/`images`, `brand`, `inStock`, `status` and other imported data. | Store a product reference rather than duplicate product fields. Legacy `title` must be supported for display. |
| `server/controllers/productsController.js` | Public product API normalizes legacy titles and queries MongoDB by `_id`. | Hero public endpoint can reuse the normalization approach, not the paginated controller. |
| `server/server.js` | Express mounts `/api/products`, `/api/admin`; `createApp(deps)` supports injected test models; JSON limit 32KB. | Mount new public router; inject new models for tests; do not alter unrelated routes. |
| `server/routes/adminRoute.js`, `server/middlewares/auth.middleware.js` | Admin router uses `auth`, `requireAdmin` and a rate limiter. Admin access checks actual stored role and 12-hour sign-in freshness. | Add protected CRUD under existing admin router. Never trust a client-provided role. |
| `server/db/db.js` | MongoDB connection is restricted to database `escowear-sneaker-import-test`; `autoCreate:false`, `autoIndex:false`. | New collection/index creation must be separately provisioned; never assume Mongoose will auto-create indexes. |
| `client/src/App.test.js`, `server/tests/productsController.test.js` | Jest/React Testing Library and Node test runner are in use. | Update existing homepage assertions; add isolated API/admin/carousel tests. |

**Not present in inspected tree:** hero slide model, hero API, carousel component, or hero admin page. Existing technical-spec docs include future ideas but are not evidence of an implemented feature.

## 3. Data model: `heroSlides` MongoDB collection

Implement `server/Models/HeroSlide.model.js` using Mongoose 6 and the repository's CommonJS style.

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `_id` | ObjectId | generated | MongoDB identity. |
| `productId` | ObjectId ref `Product` | yes | Must reference an existing product at create/update; not duplicated into slide data. |
| `headline` | string | yes | Trimmed, 1–90 characters; plain text only, no HTML. |
| `description` | string | no | Trimmed, max 180 characters; empty becomes empty string. |
| `desktopImage` | string | no | Optional approved image URL/path for wide hero creative. |
| `mobileImage` | string | no | Optional approved image URL/path for portrait hero creative. |
| `order` | integer | yes | 0–999; ascending order, then `_id` for stable ties. Set automatically on creation if omitted only when explicitly supported by form; API requires a valid integer. |
| `isActive` | boolean | yes | Default false on creation; only active slides appear publicly. |
| `createdAt`, `updatedAt` | Date | generated | Mongoose timestamps. |

**No `ctaText`, `ctaUrl`, price, size or product name fields** in this collection. The UI always renders “Shop Now”; the API returns the product ID needed for `/details/:id`.

**Indexes:** `{isActive:1,order:1,_id:1}` for public reads and `{order:1,_id:1}` for admin listing. Index provisioning must use an explicit, owner-reviewed database script/process consistent with `autoIndex:false`. Do not add a unique constraint on `order`: equal values have deterministic tie-breaking. Prevent duplicate product entries via validation/service logic (or a unique `productId` index if the product owner confirms one slide per product). For this feature **enforce one slide per product** via a unique `productId` index and return conflict on duplicate.

### Example persisted document (illustrative ObjectIds)

```json
{
  "_id": "672b0e3a1a2b3c4d5e6f7001",
  "productId": "672b0e3a1a2b3c4d5e6f7002",
  "headline": "AIR JORDAN. ICONIC FOREVER.",
  "description": "Authentic pairs sourced in the UK, delivered to Ghana.",
  "desktopImage": "",
  "mobileImage": "",
  "order": 0,
  "isActive": true,
  "createdAt": "2026-11-05T00:00:00.000Z",
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```

### Image handling

1. Use a verified, accessible `desktopImage` when supplied; otherwise `product.image`, then first valid `product.images`, then existing product-image fallback.
2. Use `mobileImage` when supplied, otherwise selected desktop image. The same image may be cropped with responsive `object-position` for mobile.
3. Allow **existing hosted HTTPS image URLs** and **safe same-origin asset paths** (e.g. `/images/...`) with a strict allowlist and length limit (max 2,048 characters). Reject `javascript:`, `data:`, `file:`, credentials-in-URL, `//`, `../`, control characters and unsupported schemes. Reject arbitrary image uploads and new storage infrastructure in v1.
4. Admin can paste an existing image URL, but v1 does **not** provide image file uploads, cropping tools, or an external CDN. Do not claim the supplied URL is guaranteed to load; show preview and explain fallback behavior.

## 4. API contract

### Public: `GET /api/hero-slides`

- No authentication; query `isActive:true`, sorted `order:1,_id:1`, hard cap at 8 active slides; do not expose hidden/draft slides.
- Resolve referenced products, preserve configured slide order and remove slides referencing deleted/invalid products. When the product is out of stock, leave the slide visible but CTA should take customers to the product page to see availability; the admin should see a stock warning. This mirrors existing stock visibility without falsely implying direct purchase.
- If an active slide has no valid product image and no supplied creative image, skip it rather than show a broken carousel hero.
- Return minimal, safe, read-only content: `{items:[{id,productId,headline,description,desktopImage,mobileImage,order,productName,productInStock}]}`. For fallback, `desktopImage`/`mobileImage` in the response are resolved effective URLs. No admin metadata, retailer private fields, or internal DB fields beyond identifiers.
- For zero slides, return `200 {items:[]}` (not a 404). For unexpected read failure return `500 {error:"Unable to load hero slides"}`; never expose stack traces.
- Cache public response briefly if useful, but avoid stale published content beyond ~60 seconds; no new caching service.

Example response:

```json
{
  "items": [
    {
      "id": "672b0e3a1a2b3c4d5e6f7001",
      "productId": "672b0e3a1a2b3c4d5e6f7002",
      "productName": "Air Jordan 1",
      "productInStock": true,
      "headline": "AIR JORDAN. ICONIC FOREVER.",
      "description": "Authentic pairs sourced in the UK, delivered to Ghana.",
      "desktopImage": "/images/shoes/air-jordan/1.jpg",
      "mobileImage": "/images/shoes/air-jordan/1.jpg",
      "order": 0
    }
  ]
}
```

### Admin: `/api/admin/hero-slides` (reuse existing admin router)

| Method + path | Action | Expected result |
| --- | --- | --- |
| `GET /api/admin/hero-slides` | List all active/inactive slides in order with enough product identity for management | 200 `{items:[...]}` |
| `POST /api/admin/hero-slides` | Create slide; validate product ref and fields | 201 `{item}` |
| `PATCH /api/admin/hero-slides/:id` | Update headline, description, images, order, visibility or product | 200 `{item}` |
| `DELETE /api/admin/hero-slides/:id` | Remove slide after admin UI confirmation | 204, no body |

For all admin operations reuse existing `auth,requireAdmin,limiter`. Deny missing/expired authentication with 401; non-admin roles with 403; invalid input/ID with 400; nonexistent slide/product with 404; duplicate product or conflicting update with 409; unexpected failures with 500. Validate submitted keys explicitly and reject unknown keys, mass assignment (`_id`, `createdAt`, arbitrary Mongo operators), excessively long content, wrong types and invalid image sources. Do not accept role fields in requests. Retain current 32KB JSON size ceiling; a slide payload should fit easily.

**Maximum 8 active slides:** reject attempts to activate a ninth with 409, not silently truncate; enforce at write time with a concurrency-safe strategy (e.g. transactional guard/serialized update) or clearly implement a deterministic constraint. Prevent races and give meaningful admin error feedback. A single draft is allowed regardless of active count.

**Product selector:** use existing `GET /api/products?search=...&limit=...` for search. Validate product existence server-side; do not send the entire catalogue to the browser.

**Additional API conventions:** errors have `{error,code?,fields?}`; never disclose exception details. Admin list avoids unbounded result sizes; use pagination if volume might grow (default max 50). Return 404 rather than leaking resource existence to unauthorized users only after auth executes.

## 5. Admin UX (`/admin/hero-slides`)

- Link from existing admin navigation, without losing the Orders link. Reuse `AdminGate`, Redux user state, `apiRequest` and `authHeader`.
- View all slides in ascending order with sneaker name/thumb, headline, order and **Active/Draft** status.
- “Add slide” opens a form with: searchable product picker (required); headline (required); description (optional); desktop image URL/path (optional); mobile image URL/path (optional); order (required); active toggle (defaults off).
- Product selection previews its existing catalogue image and detail link; custom images preview separately. Explain: absent mobile image uses desktop; absent desktop image uses product catalogue image.
- Submit creates/updates immediately after successful server response; display field errors and preserve unsaved inputs on failure. Support edit, draft/publish and delete with confirmation. Prevent double-submit.
- Offer simple up/down ordering controls or numeric order editing. If using up/down controls, persist updated ordering via API without leaving incomplete interim displays.
- Show active-slide count (e.g. 3/8), a warning for products marked out of stock, and preview of mobile/desktop hero crop. No CTA field in form.
- Require logged-in admin; show sign-in/forbidden feedback through existing gate. A hidden UI is **not** a security boundary; all writes are server protected.
- No drag-and-drop package, WYSIWYG editor, image uploader, scheduled publishing or analytics in v1.

## 6. Storefront hero UX

### Loading and failure

- `Home` continues its existing `getProducts({limit:8,page:1})` call independently.
- `HeroCarousel` calls `GET /api/hero-slides` once on mount with `AbortController` cleanup. Show a visually stable skeleton/background while loading; avoid layout shift.
- On 200 with empty list or network/5xx error, render a **static, usable fallback** with “Authentic UK sneakers. Delivered to Ghana.” and a “Shop Now” button linking to `/store`. This is the one fallback exception to per-product CTA routing.
- One valid slide: render without autoplay, arrows or dots. More than one: enable carousel controls.

### Desktop

- Full viewport-width media with dark gradient overlay, high-contrast white headline, optional single short description, fixed CTA and discreet progress/navigation.
- Hero height: approximately remaining viewport below header, with a sensible min/max for narrow windows. Avoid hiding key copy beneath the header.
- Shoe/creative stays visually central/upper region; avoid crop that cuts the product unexpectedly. Use responsive `object-fit:cover` for designed hero creatives, `contain` with appropriate dark backdrop for catalogue cutouts.
- Font tokens from `client/src/index.styles.css`; keep existing header. First slide contains the page's single meaningful `h1`. Hide inactive slide copy from accessibility tree.

### Mobile (<=760px baseline)

- Single overlaid image hero, approx **75dvh below header** while respecting minimum readable height and safe-area padding; copy anchored bottom-left with roughly 20–24px horizontal margins.
- Bold white 32–44px headline, 2–3 lines ideally, short description and CTA immediately beneath it; gradient darkens bottom ~60%; shoe framed in upper half.
- Swiping left/right changes slides; screen-reader and keyboard users can use accessible Previous/Next buttons and dots. Touch interaction must not block vertical scrolling.
- No separate media-then-copy stack; avoid mobile viewport jump and text overlap on 320px screens.

### Motion and controls

- Six-second autoplay interval per visible slide; 700–900ms crossfade/zoom, with sequential headline/description/CTA reveals.
- Pause when hovered, when focus enters hero, when document/tab hidden, and when user explicitly pauses. Provide a labelled **Pause / Play** control. Resume only as appropriate after interaction.
- Next/Previous buttons and clickable pagination dots on desktop, usable keyboard focus and minimum 44px touch targets on mobile.
- Do not force autoplay for `prefers-reduced-motion: reduce`; use instant/no animation and require explicit play if motion preference disallows automatic changes.
- Avoid animating offscreen DOM with large resource cost. Prevent timers accumulating across renders; clear timers/listeners on unmount. Ensure exactly one active slide is accessible and focus is not moved unexpectedly on slide changes.

### Performance

- First slide image loads eagerly with `fetchpriority`/supported React attribute as appropriate, later slide images lazy/preloaded just before display. Provide `sizes`/`srcSet` only if the source actually has known variants.
- Respect image aspect ratio, offer dark CSS fallback, and handle failed image requests gracefully. Do not preload full catalogue product images.
- Implement with React state/effects and CSS transitions; **no new animation or carousel dependency required**. Do not interfere with existing product-grid Redux state.

## 7. Proposed changes

| Path | Planned work |
| --- | --- |
| `server/Models/HeroSlide.model.js` | Schema, validation and index declarations |
| `server/controllers/heroSlidesController.js` | Public read + admin CRUD with dependency injection |
| `server/routes/heroSlidesRoute.js` | Public endpoint |
| `server/routes/adminRoute.js` | Add protected CRUD within existing admin router |
| `server/server.js` | Mount public route and dependency-injected hero model |
| `server/scripts/ensureHeroSlideIndexes.js` | Explicit index provisioner (no automatic production writes at server startup) |
| `client/src/components/HeroCarousel/HeroCarousel.component.js` | Fetch, render, navigation, accessibility, timing |
| `client/src/components/HeroCarousel/heroCarousel.styles.css` | Responsive cinematic design, animation, gradient |
| `client/src/Pages/Home/Home.page.js` | Replace current hero with `HeroCarousel` |
| `client/src/Pages/Home/home.styles.css` | Retire old hero-only CSS without affecting shared components |
| `client/src/Pages/AdminHeroSlides/AdminHeroSlides.page.js` | Admin list/form/edit/delete |
| `client/src/Pages/AdminHeroSlides/adminHeroSlides.styles.css` | Admin UI styles |
| `client/src/Pages/index.js`, `client/src/App.js` | Export and route admin page |
| `client/src/components/Header/Header.component.js` | Admin navigation link |
| `server/tests/heroSlides.test.js` | Public/admin API behavior, validation, auth, sorting, fallbacks |
| `client/src/App.test.js` and dedicated carousel/admin tests | Update homepage fetch mocks and test navigation, motion, failures |

Filename layout may adapt to repository conventions when coding; do not move or rewrite unrelated files.

## 8. Acceptance criteria

1. Homepage hero content is loaded exclusively from `GET /api/hero-slides`; no hardcoded showcase products. Existing product sections still load through `/api/products`.
2. Admin can search catalogue products, create/edit/draft/publish/order/delete up to 8 active slides. All operations persist in the `heroSlides` collection and survive reload.
3. Only authenticated, recently signed-in admin users can mutate slides; unauthorized calls fail with correct statuses and no data change.
4. Existing product name/image is resolved through `productId` without copying product data into slides. Missing product is rejected on create/update, and stale refs are omitted from public results.
5. Hero CTA always says **“Shop Now”** and navigates to `/details/<productId>` (fallback static hero may use `/store`).
6. Desktop has cinematic overlaid headline/text; mobile has bottom-left overlay, readable gradient and swipe support, not stacked copy.
7. Multi-slide autoplay/crossfade/controls work, pause safely and respect reduced-motion preference; single-slide presentation has no redundant controls.
8. Empty/error API response does not blank homepage; display a working fallback and keep product grids functional.
9. Invalid IDs, duplicate product references, invalid image URLs, too many active slides and concurrent edits return clear errors and do not result in partial writes.
10. Existing routes, authentication, checkout safeguards, product image fallbacks and unrelated homepage sections continue working.
11. Targeted server tests, React tests, lint and production build pass; browser smoke verifies desktop/mobile layout, CTA navigation, pause/swipe and authenticated admin flow using **disposable** test data.
12. No production database writes, DNS/Nginx changes, public-port changes, production deployment or automatic main-branch release occurs without separate explicit owner approval.

## 9. Testing and verification plan

- **Node tests:** successful active read and stable sorting; admin happy paths; product lookup; invalid fields and IDs; unique-product conflict; cap at eight; 401/403/404/409; missing referenced products; image URL validation; fallback behavior.
- **React Testing Library:** loading/success/empty/error states; fixed CTA; image fallbacks; only one active accessible slide; manual controls; 6s timers with fake timers; pause/visibility/focus; reduced motion; admin form validation and error recovery.
- **Existing suite:** `npm run test:server`; `CI=true npm test --prefix client -- --watchAll=false`; `npm run lint --prefix client`; `CI=true REACT_APP_POLICIES_STATUS=hidden npm run build --prefix client`.
- **Browser smoke (test environment only):** mobile widths ~320/375/430px plus desktop; image/copy overlap, swipe, keyboard controls, no navigation outside product details, existing featured/latest sections, admin auth, preview and publish/unpublish. Test against disposable MongoDB and seeded sample products/slides.
- Record results, failures and exact changes before any implementation approval or release claim.

## 10. Rollout and rollback

1. Implement and test without touching the live database. Seed only the test database with test products/slides.
2. Before a production rollout, review new index plan and verify a **fresh** MongoDB backup/recovery strategy; provision required collection/indexes only after approval.
3. Deploy server + client together after independent deployment approval; the empty-collection fallback makes first deploy safe without existing slides.
4. Publish one trial slide, verify desktop/mobile/CTA, then add more slides. Avoid automatically promoting any draft.
5. Roll back the application image using established Beast procedure if required; leave the non-destructive `heroSlides` collection intact for later use. Do not drop the collection as part of routine rollback.

## 11. Explicit non-goals

- Rewriting the product catalogue/importer or checkout.
- Replacing Redux for existing product grids.
- Full CMS, hero image uploads, CDN/image transformation service, or new third-party animation dependencies.
- Changing CTA text per slide, adding price/discount promises to hero, auto-buy, external retailer redirect or payment logic.
- Auto-selecting published products from the catalogue, scheduled campaigns, visitor analytics, translations or product recommendation rankings.

## 12. Implementation handoff

**Definition of ready:** Contract and UX above are approved for implementation; no material architecture decision remains except confirming whether the hero creative URL/path inputs should be accepted as described. Any new upload requirement needs a separate image storage/security contract.

**Recommended delivery:** One complete feature (schema + indexes + public API + protected admin CRUD + admin page + carousel + targeted tests), with no unnecessary micro-tickets. Work in a suitable task branch for coding; this specification file itself is a documentation-only change on the user-requested `master` branch. Do not infer permission for a later production deployment from this document commit.

**Current state:** Specification only. No carousel code, database records, indexes, uploads or live runtime changes were made.
