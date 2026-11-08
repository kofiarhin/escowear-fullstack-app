# IDE-135 — EscoWear Admin-Managed Featured Sneakers

**Status:** Implementation specification, ready for review; feature not implemented  
**Date:** 8 November 2026  
**Repository:** `kofiarhin/escowear-fullstack-app`  
**Inspected baseline:** `master` at `236052f939a89850318a7e1f8fe55bc544b6f05c`  
**Documentation branch:** `docs/ide-135-featured-sneakers-spec`  
**Tracking:** [IDE-135](https://linear.app/ideahub-devkofi/issue/IDE-135/escowear-implement-admin-managed-featured-sneakers-section)  
**Execution authority:** Documentation only. Do not implement the feature, open a PR, merge, migrate production data, or deploy without separate approval.

## 1. Goal and finish line

Replace the current automatic selection of the first four catalogue products in **Featured Sneakers** with an admin-controlled set of existing products. The admin can select, add, remove, replace and reorder sneakers from the existing catalogue, then save the new storefront selection in MongoDB.

**Finish line:** After an authenticated admin saves a selection, the homepage shows those exact eligible products in the chosen order, consistently after page refreshes and server restarts. Changing Featured Sneakers never creates, edits, unpublishes or deletes the underlying catalogue product.

This feature affects **Featured Sneakers only**. The homepage hero carousel and **Latest Releases** remain independent.

## 2. Decisions and scope

### Product and UX contract

- The management entry point is **Admin → Products → Manage Featured Sneakers**; the dedicated page route is `/admin/products/featured`.
- Select **existing published catalogue products**, both imported and manually created. There is no create-product form inside Featured management; link to the existing **Add product** flow if necessary.
- Keep the current **four product slots maximum**. Admin may save zero, one, two, three or four selected products. A zero-item selection is intentional.
- Allow search by name/brand, add an eligible result, remove a selected item, reorder with **Move up / Move down** controls, and replace an existing item by removing it and adding its replacement.
- The admin sees the saved selection, a draft selection, a preview of the order, **Save changes** and **Discard changes**. Changes are not published until saved.
- The selected products are regular Product cards and link to the existing `/details/:id` route. No extra editorial fields, custom images, new card layouts or special checkout rules.
- Products with `status: "draft"` are ineligible; products with missing `status` remain eligible for backwards compatibility. Out-of-stock products remain eligible and retain the existing sold-out badge. Their inclusion is an intentional merchandising choice and must not override checkout stock validation.
- When a product becomes a draft or is deleted later, omit it from the public Featured response automatically without removing the stored selection or silently filling its slot. Admin should see the invalid entry with a warning and can remove or replace it. This retains the editor's explicit intent.
- **No automatic fallback to the first four products** after the feature is enabled, even when no featured configuration exists. Public response is an empty list; the existing Featured Sneakers section stays visible with the existing empty-state copy and Store link. This ensures admin ownership rather than hidden automatic merchandising.
- Selection/order are independent of the catalogue's current sort, page and importer refresh. No extra dependencies or product imports are needed.

### In scope

1. MongoDB persistence for one ordered Featured Sneakers configuration.
2. Public read endpoint with resolved Product objects, eligible-product filtering and stable order.
3. Authenticated admin read/write endpoints with validation, authorization, conflict handling and safe errors.
4. Dedicated admin management screen linked from the existing Products screen.
5. Update only the homepage Featured section's data source, loading/retry/empty logic; preserve Latest Releases.
6. Focused server, frontend, security, concurrency, and regression tests.

### Out of scope

- Hero slide management, Latest Releases selection, categories, store pagination or search changes.
- Changing Product schema, product publishing/editing, inventory, ordering/checkout or importers.
- Creating, modifying or deleting products from Featured management.
- Scheduling featured dates, badges, text, custom images, analytics, automation, drag-and-drop libraries, bulk merchandising, new admin roles.
- PR, merge, production migration, production deployment, live verification without separate approval.

## 3. Codebase inspection — verified

| Source | Observed behavior / implementation implication |
| --- | --- |
| `client/src/Pages/Home/Home.page.js` | Dispatches `getProducts({limit:8,page:1})`, then `featuredSneakers = sneakers.slice(0,4)` and `latestSneakers = sneakers.slice(4,8)`. Decouple Featured fetch while retaining latest logic unchanged. |
| `client/src/redux/actions/products.actions.js`, `client/src/redux/reducers/products.reducer.js` | Shared Redux catalogue action/state; its status/error currently controls both homepage sections. Keep it for Latest Releases; add independent local state or dedicated feature state for Featured so errors do not cross-contaminate. |
| `client/src/Pages/Home/home.styles.css` | `.home-product-grid` is four columns on desktop with responsive breakpoints; reuse its styles and `ProductSkeletons` / `Product`. |
| `client/src/components/Product/Product.component.js`, `client/src/utils/product.js` | Cards expect `_id`, `name`, image, stock, currency/price, category and optional colour; reuse the exact card and name/image normalisation. |
| `client/src/Pages/AdminProducts/AdminProducts.page.js` | Existing admin Products table, creation/edit flow, `AdminGate`, authenticated `apiRequest`; add a secondary **Manage Featured Sneakers** link without removing **Add product**. |
| `client/src/Pages/AdminHeroSlides/AdminHeroSlides.page.js` | Existing searchable product picker, admin read/write and loading/error patterns; borrow compact UI practices without coupling Featured to HeroSlide records. |
| `client/src/App.js`, `client/src/Pages/index.js` | React Router v6 with `/admin/products`, `/admin/products/new`, `/admin/products/:id/edit`; register distinct `/admin/products/featured` **before** `/:id/edit` for clarity. |
| `client/src/components/Header/Header.component.js` | Shows Products link only to admins. Feature should be reachable via Products; no extra header link required. |
| `client/src/utils/api.js` | Shared JSON `apiRequest` and `authHeader`; use for admin endpoints, `fetch` / abort for public read. |
| `server/Models/Product.model.js` | Existing Product `_id`, `name/title`, `status`, `image/images`, `inStock`; no feature flag exists and none is needed. |
| `server/controllers/productsController.js`, `server/routes/productsRoute.js` | Public catalogue uses `status:{$ne:"draft"}`, name normalization and stable recency sorting. Do not edit or repurpose catalogue pagination to power Featured. |
| `server/routes/adminRoute.js`, `server/middlewares/auth.middleware.js` | All `/api/admin` routes require authenticated, fresh admin session and rate limit. Mount new admin handlers under the existing guard, not a parallel unprotected route. |
| `server/controllers/heroSlidesController.js`, `server/Models/HeroSlide.model.js` | Existing separate presentation collection referencing Product, with public and admin endpoints, stable ordering and rejection of bad IDs. Featured deserves a separate simpler configuration model, not hero slide reuse. |
| `server/server.js` | Express app mounts public/admin routes, JSON limit 32 KB, and supports dependency-injected controllers for tests. |
| `server/db/db.js` | Mongoose connection uses `autoCreate:false`, `autoIndex:false`; collection/index provisioning must not rely on Mongoose auto-index. |
| `server/tests/helpers/testApp.js`, `server/tests/helpers/memoryModel.js` | Injectable in-memory models; new model should be injected into public/admin router during tests. Memory model supports relevant filters and atomic `findOneAndUpdate` patterns only if verified/extended. |
| `server/tests/heroSlides.test.js`, `server/tests/adminProducts.test.js`, `client/src/App.test.js`, `client/src/Pages/AdminProducts/AdminProducts.test.js` | Node built-in test runner and Jest/React Testing Library provide reference patterns. Existing homepage test mocks need new Featured response. |
| `package.json`, `client/package.json` | Server: `npm run test:server`; React: `npm test --prefix client -- --watchAll=false`, `npm run lint --prefix client`, `npm run build --prefix client`. No new package required. |

No `AGENTS.md` or `CLAUDE.md` file was found in the inspected GitHub tree. GitHub source inspection does not establish the live database contents or production deployment state.

## 4. Data design

Use a dedicated MongoDB `featuredSneakers` singleton document, not per-product flags, because the whole selection must be saved atomically and ordered.

**Proposed `server/Models/FeaturedSneakers.model.js`:**

```js
{
  _id: "homepage",             // fixed string _id, unique by MongoDB
  productIds: [ObjectId],     // ordered, 0..4, no duplicates
  version: Number,            // positive integer, starts at 1
  updatedAt: Date,
  updatedBy: ObjectId         // ref User (audit convenience)
}
```

- This is a Mongoose schema/model with `collection:"featuredSneakers"` and a fixed `_id` string. The controller never accepts arbitrary document IDs or query selectors.
- No additional secondary index is needed: `_id` has MongoDB's inherent unique index; `Product` resolution uses existing `_id`.
- If document is absent, read the virtual initial config `{productIds:[],version:0,updatedAt:null}` without writing on GET. First authorized save atomically creates version 1. Do not import old auto-selected products.
- **Write atomicity / concurrency:** Each save carries the version last read. Update via one conditional `findOneAndUpdate({_id:"homepage",version:expectedVersion},{$set:{productIds,updatedBy,updatedAt},$inc:{version:1}}, {new:true})`; for initial creation use `create` with version 1 only if `expectedVersion === 0`. Duplicate-key or failed conditional update returns `409 STALE_FEATURED_SELECTION`. Do not pre-read and unconditionally overwrite. This works across multiple Node processes and prevents lost updates.
- A successful save replaces the **entire array**, not individual slots. No separate add/delete endpoints are needed; removing from this array is not deleting a Product.
- Manually removed products remain in `products`, saved carts, orders, search and the shop unchanged.
- Store only Product references; resolve current price, imagery, stock, display name and metadata on every public request. This avoids stale merchandising copies when catalogue products change.
- MongoDB must have permission to create `featuredSneakers` on first write, or the new collection must be provisioned separately before rollout. Never modify the guarded database name, global auto-index flags or database credentials for this feature.
- No migration of existing Product records, HeroSlide data or existing orders.

## 5. API contract

### Public GET `/api/featured-sneakers`

- No authentication required. Wire a new public router in `server/server.js`.
- **200** response: `{items:[<public Product objects>],version:number}` sorted by configured `productIds`; max 4. `version:0` and `items:[]` if config missing.
- Preserve full Product fields expected by current `Product` card / detail link, normalize legacy `title` to `name` like `productsController`, and never expose configuration `updatedBy`.
- Ignore stored IDs that no longer resolve or resolve to `status:"draft"`. Do not fill gaps from the catalogue. Keep out-of-stock products (existing badge handles them). Guarantee no duplicate products even if legacy/corrupt config ever contains duplicates.
- Use one bounded Product query with `_id:{$in:...}`, followed by in-memory ordering by requested IDs (never rely on MongoDB `$in` ordering); a clean empty response requires no product query.
- Never return internal or draft product data. On read failure return **500** `{error:"Unable to load featured sneakers",code:"FEATURED_READ_FAILED"}`; do not use fallback catalogue selections.

### Admin GET `/api/admin/featured-sneakers`

- Existing `auth`, `requireAdmin` and limiter apply.
- **200** `{item:{productIds:[string],version:number,updatedAt:string|null,products:[{...}]},warnings:[{productId,reason}]}`.
- `products` is aligned with existing IDs for resolved records; include draft/deleted/missing warnings so the admin can repair an invalid selection. For missing products include no fabricated Product object. Keep `productIds` in full even if some cannot render.
- Missing config yields `{item:{productIds:[],version:0,updatedAt:null,products:[]},warnings:[]}`.
- Lookup error returns **500** `{error:"Unable to load featured selection",code:"FEATURED_READ_FAILED"}`.

### Admin PUT `/api/admin/featured-sneakers`

- Exact JSON body: `{productIds:["24-hex-object-id",...],expectedVersion:0}`. The list order becomes display order.
- Strict allowlist for `productIds` and `expectedVersion`; reject extra keys, arrays as the root, malformed JSON and missing fields.
- Validate array length **0–4**, each ID canonical 24-character hexadecimal ObjectId string, no duplicates (case-insensitive normalization). Require `expectedVersion` to be a safe nonnegative integer.
- Re-check every selected Product ID server-side in one query: it must exist and have `status !== "draft"`. Imported records with missing `status` are accepted; out-of-stock records are accepted.
- **200** `{item:{productIds:[string],version:number,updatedAt:string,products:[...]},warnings:[]}` on success. Even an identical explicit save can increment version; no ambiguous partial success.
- **400** `{error:"Invalid featured selection",code:"INVALID_FEATURED_SELECTION",fields:{...}}` for invalid structure, count, duplicate, invalid ID or unknown field.
- **422** `{error:"One or more products are unavailable",code:"INELIGIBLE_FEATURED_PRODUCTS",fields:{productIds:"..."}}` when missing/draft product is selected. Admin must remove/reselect; do not silently drop bad requested IDs during save.
- **409** `{error:"Featured sneakers changed elsewhere. Refresh and try again.",code:"STALE_FEATURED_SELECTION"}` for stale version or racing initial create.
- **401/403/429** via existing protected admin router and rate limiter. **500** `{error:"Unable to save featured selection",code:"FEATURED_SAVE_FAILED"}` for unexpected DB failure.
- The response never returns secrets, internal stack traces, or arbitrary client-controlled Mongo expressions.
- Read-only product search uses the existing public `GET /api/products?search=...&limit=...` endpoint; it already excludes drafts. The admin MUST still validate server-side on PUT.
- JSON request stays well under the existing 32 KB limit.

**Race/eligibility note:** A product can become a draft after validation but before/after saving (via another admin). This is safe because every public GET independently filters current draft status; the featured list simply omits it until repaired. Repeated saves on stale versions remain conflicts.

## 6. Frontend UX

### Entry

- Add `Manage Featured Sneakers` alongside `Add product` in `client/src/Pages/AdminProducts/AdminProducts.page.js`. Ensure both actions remain visible on small screens.
- Add new page `client/src/Pages/AdminFeaturedSneakers/AdminFeaturedSneakers.page.js` and scoped stylesheet, exported from `client/src/Pages/index.js` and registered at `/admin/products/featured` in `client/src/App.js`.
- Reuse `AdminGate`, Redux user, `apiRequest`, `authHeader`, logout-on-401, admin styling and Product image helpers. Do not add an admin dashboard product that does not currently exist.

### Screen layout and behavior

1. Header: **Admin / Catalogue**, **Manage Featured Sneakers**, description **Choose up to four sneakers for the homepage**, **Back to products**.
2. **Current selection** list: one row per slot with thumbnail, name/brand, stock, position and **Move up**, **Move down**, **Remove**. Missing/draft entries show a warning, ID and **Remove**, not a fake image.
3. **Find products**: searchable input (name or brand), product result list with image/name/stock and **Add**; enter key submits search, prevent empty searches, show no-result state. Disable Add for already selected items or when four slots are full. Reuse `GET /api/products?search=...&limit=10`; abort/cancel stale requests, do not let older searches overwrite newer results.
4. **Save changes** commits complete selection via PUT and updates `version` from response. **Discard changes** restores last loaded successful selection. Disable Save with no changes or while saving; warn on unsaved navigation/tab close consistent with existing product form.
5. Show preview in actual card order; reuse existing Product component only if layout fits, otherwise use existing image/price helpers to avoid duplicating business logic.
6. Loading skeleton/status and explicit loading failures with **Try again**. Empty selection explains that the homepage will show the empty-state message. Show success message only after server 200; no optimistic live-publication claim.
7. On **409**, retain the admin's attempted draft locally, show **Someone changed this selection. Reload before saving** and offer **Reload saved selection**; do not overwrite it automatically.
8. On **401**, follow existing logout path; **403** shows access denied; **422/400** show actionable errors; network failures show retry without losing draft. Avoid duplicate PUT submissions.
9. Keyboard accessible, labelled controls, usable focus/announcements, move controls as accessible alternative to drag and drop; ensure 320 px mobile layout is usable.

### Public homepage

- Keep `getProducts({limit:8,page:1})` and `latestSneakers=sneakers.slice(4,8)` **unchanged**, to preserve latest releases behavior rather than unexpectedly change the definition of Latest Releases.
- Introduce a separate `fetch("/api/featured-sneakers",{signal})` in `Home.page.js`, with its own `featuredState`, `featuredItems`, `featuredError` and abort-on-unmount. Do not reuse the current Redux `status` for Featured.
- Keep existing `<section className="featured ...">`, heading, link, grid, skeleton and `Product` card. Refactor `renderProducts` to accept independent status/error/retry callbacks (or create a very small shared section renderer).
- Public Featured loading shows four skeleton placeholders; empty returns existing empty copy and Store link. Error shows the existing error treatment and **Try again** for featured fetch only. A failure loading Featured must not hide Latest Releases, and the inverse also holds.
- Explicit admin-selected order is preserved; section renders no more than four cards.

## 7. Exact anticipated implementation files

**New**
- `server/Models/FeaturedSneakers.model.js` — singleton schema.
- `server/controllers/featuredSneakersController.js` — injected public/admin handlers, validation, product resolution, compare-and-set saving.
- `server/routes/featuredSneakersRoute.js` — public GET router.
- `client/src/Pages/AdminFeaturedSneakers/AdminFeaturedSneakers.page.js` — admin selection UI.
- `client/src/Pages/AdminFeaturedSneakers/adminFeaturedSneakers.styles.css` — scoped desktop/mobile styles.
- `server/tests/featuredSneakers.test.js` — public/admin integration, concurrency/security tests.
- `client/src/Pages/AdminFeaturedSneakers/AdminFeaturedSneakers.test.js` — admin interaction tests (optional separate suite if existing App-level test covers all flows).

**Edit**
- `server/server.js` — public route mounting, injected model/controller wiring.
- `server/routes/adminRoute.js` — admin GET/PUT under existing auth guards.
- `server/tests/helpers/testApp.js` — inject new in-memory singleton model for both routers.
- `server/tests/helpers/memoryModel.js` — only if current atomic update support is insufficient; test with MongoDB for actual concurrency.
- `client/src/Pages/Home/Home.page.js` — independent Featured data fetch and state.
- `client/src/Pages/AdminProducts/AdminProducts.page.js` — navigation link.
- `client/src/App.js`, `client/src/Pages/index.js` — route and export.
- `client/src/App.test.js`, `client/src/Pages/AdminProducts/AdminProducts.test.js` — existing test mocks and navigation assertions.

No Product schema or importer change is expected. Exact file additions and test boundaries may be adjusted only as an equivalent, minimal implementation within this scope.

## 8. Acceptance criteria (unchecked until verified)

### Storefront / data
- [ ] On an unconfigured database, public GET returns `{items:[],version:0}`; homepage does **not** silently select recent products.
- [ ] Admin can add 1–4 existing visible products and save; refresh/restart preserves exact order.
- [ ] Admin can remove all featured products and save intentionally empty selection.
- [ ] Admin can replace a selected sneaker without changing its Product record.
- [ ] Reordering slots changes the homepage order exactly; stable across refresh.
- [ ] Existing imported products without `status` can be featured; manually published products can be featured.
- [ ] Draft/missing products never appear publicly, but admin can see warnings and repair the saved selection.
- [ ] Out-of-stock featured products preserve existing sold-out display and checkout rules.
- [ ] Product name, image, price and availability reflect current catalogue data without copying into the feature document.
- [ ] Existing Featured heading/link/responsive Product cards remain intact; Latest Releases stays based on the prior catalogue logic.
- [ ] Featured and Latest Releases handle their own loading, empty, failure and retry states independently.

### Security and consistency
- [ ] Missing/expired admin credentials return 401; customer/nonadmin returns 403; none can edit.
- [ ] Invalid IDs, duplicate products, oversized arrays, unknown fields and malformed body do not mutate selection.
- [ ] Draft/missing selection attempts return 422 and do not partially save.
- [ ] Concurrent writes with same version yield one success and one 409; no lost update.
- [ ] Public API never leaks draft product details or internal admin-only config.
- [ ] On save failure, previously stored config remains unchanged.
- [ ] Admin UI stays keyboard-accessible, with clear errors and responsive mobile controls.
- [ ] No regressions to product creation, publish/unpublish, hero, catalogue search, cart or checkout.

## 9. Verification plan

1. Add tests for absent config, zero through four selected products, order stability, stale/missing/draft products, legacy name fallback, stock presentation, read errors.
2. Test admin unauthorized, non-admin, expired session, malformed payload, duplicate/canonical IDs, invalid count/fields, missing product, draft product, first write, update and intentionally empty configuration.
3. Test two simultaneous writes to same version against **real MongoDB** (opt-in `npm run test:realdb` or targeted DB test) because in-memory emulation may not prove atomicity. If DB not available, mark concurrency unverified, not passed.
4. Test admin UI: navigation from Products, search/add/duplicate-blocking/four-limit, remove, reorder, save/discard, stale conflict, backend errors, access gate, mobile semantics.
5. Update homepage `client/src/App.test.js` to mock separate `/api/featured-sneakers` and `/api/products`; confirm independent failure paths and existing hero/store links.
6. Run targeted `node --test server/tests/featuredSneakers.test.js`; existing `npm run test:server`; `CI=true npm test --prefix client -- --watchAll=false` (target selected tests first); `npm run lint --prefix client`; `npm run build --prefix client`. Note exact observed results. Test on desktop/mobile if interactive browser is available.
7. Check schema/collection creation against `autoCreate:false` and `autoIndex:false`; verify on a **non-production** MongoDB connection with the configured allowed database name.
8. Post implementation evidence, blockers and Next Action to IDE-135. Mark Done only after required checks; never treat green tests as production proof.

## 10. Rollout and recovery (future, not authorized)

- Deployment changes require explicit approval and appropriate Beast/runtime verification. No live database changes are authorized by this specification.
- Server/client changes must be released together, since the homepage will request the new public endpoint. Avoid shipping a frontend that depends on an unavailable endpoint.
- First launch intentionally starts empty until an admin selects featured items. If an initial set is desired, do so through the approved admin UI **after rollout** rather than an implicit migration.
- If API read fails at runtime, public Featured shows retry/error, while other homepage sections continue to work. Recover by restoring the service or reverting the release; prior Product data is untouched.
- Do not drop the new collection during rollback without separate destructive-data approval. Existing `products` and `heroSlides` are unaffected.

## 11. State and handoff

**Ticket:** IDE-135 — Backlog pending approval.  
**Spec:** Written from repository evidence; ready for user review.  
**Implementation:** Not started.  
**Feature tests/build:** Not run; only documentation added.  
**PR / merge / deployment:** Not authorized; none performed.  
**Next Action:** Review this contract and approve implementation as a separate step. Material changes to product scope, data, security or checkout behavior require renewed approval.
