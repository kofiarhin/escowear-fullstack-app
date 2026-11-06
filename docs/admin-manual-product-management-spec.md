# Escowear — Admin Manual Product Management

**Status:** Proposed implementation specification; not implemented
**Date:** 6 November 2026
**Repository:** `kofiarhin/escowear-fullstack-app`
**Inspected base:** `master` at `71f96fe079fbbc4877840a887c0e034eebde396f`
**Scope:** Admin product creation, editing, publishing, images and listing; no changes to customer checkout contracts beyond draft visibility.

## 1. Goal and decisions

Give an authenticated Escowear admin an interface to manually create a product in the existing MongoDB `products` collection, upload its images, preview the listing, save a draft, edit it, and publish it to the public shop. Keep externally imported catalogue records working without migration.

Decisions reflected in this specification:
- New manually created products **start as drafts**. The admin explicitly publishes them.
- Existing imported products without a `status` remain publicly visible.
- Image files go to **Cloudinary**, while MongoDB stores only image URLs and Cloudinary asset identifiers. Cloudinary is a proposed new integration, not a current dependency.
- Reuse the existing protected `/api/admin` router and product schema.
- Support admin list, create, edit, publish/unpublish, and upload flows; no hard delete in this feature.
- Use an editable, responsive form and live product preview matching the conversation's mock-up. It is a concept image, not an exact representation of current CSS.

## 2. Verified codebase fit

| Existing source | Verified behavior | Required change |
|---|---|---|
| `server/Models/Product.model.js` | Mongoose Product has required `name`, `price`; optional `sizes`, `category`, `currency`, `image`, `images`, `brand`, `gender`, `inStock`, `status`, `source`, timestamps. Partial unique index on `source.provider` + `source.canonicalKey`. | Reuse model; add optional fields for description and owned Cloudinary image metadata. |
| `server/routes/adminRoute.js` | `auth`, `requireAdmin`, rate limiter protect every admin route. Default `models` does not include Product, but injected test models do. | Add Product default; mount admin product and upload handlers under existing guard. |
| `server/controllers/productsController.js` | `GET /api/products` and `GET /api/products/:id` return products without filtering drafts. | Exclude draft records in both public endpoints, retaining legacy products. |
| `server/services/orderService.js` | Rejects orders if `status` is set and not `active`, `inStock === false`, invalid price, non-GBP currency, or missing selected size. | Ensure publish preconditions match checkout; preserve defence-in-depth. |
| `server/server.js` | JSON parser limit 32 KB, admin router mounted at `/api/admin`, dependency injection via `createApp`. | Keep JSON routes small; handle multipart uploads with streaming middleware on a separate route. |
| `client/src/App.js`, `Header/Header.component.js` | Admin pages currently Orders and Hero slides. | Add Products navigation, list, new, edit pages. |
| `client/src/Pages/AdminOrders/AdminOrders.page.js` and AdminHeroSlides | Reusable `AdminGate`, `apiRequest`, bearer auth, admin forms, inline validation. | Follow existing patterns. |
| `client/src/utils/product.js` | Image resolution: `image` then first `images`, then local fallback; price formatting GBP. | Keep `image` in sync with first image. |
| `server/tests/helpers/testApp.js` | In-memory test Product model, dependency-injected Express app and admin tests. | Extend test fixtures and add protected product API tests. |
| `server/controllers/heroSlidesController.js` | Public hero returns slide content for a referenced product without checking product status. | Hide/unpublish draft-linked slides from public hero response. |

The earlier MVP technical spec is planning material, not evidence that admin product CRUD already exists. The live MongoDB contents and Cloudinary credentials were not inspected.

## 3. User flows and UI

### Navigation
- Under the existing authenticated admin header, add **Products** linking to `/admin/products`.
- Routes: `/admin/products` (list), `/admin/products/new` (new form), `/admin/products/:id/edit` (edit form).
- Admin access gating is provided by the existing `AdminGate`. Do not introduce a separate visual auth scheme. Display ordinary site navigation rather than creating the mock-up's Dashboard/Customers pages, which do not exist.

### Admin product list
- Paginated table/cards with thumbnail, name, brand, GBP price, status (Draft/Published), stock indicator, source (Manual/Imported), last updated and **Edit**.
- Search by name or brand; filter by status and manual/imported; list shows drafts but public list never does.
- **Add Product** action. No bulk changes and no delete.
- Imported items may be viewed but **not edited or unpublished** through this feature, to avoid conflicting with the importer. Only `source.provider === "manual"` is mutable in these endpoints.

### Create/edit form
Desktop: two-column layout; left form, right sticky live preview. Mobile: single column, preview after key fields; save/publish actions remain visible without overlapping content.

Form fields:
1. **Product Name** — required for publishing; optional while saving a draft.
2. **Price (GBP)** — decimal, >0, maximum two fractional digits; required for publishing. Store numeric pounds (`149.99`), not a formatted string.
3. **Brand** — text, optional draft, required to publish.
4. **Category** — text/controlled choices aligned with existing shop categories; required to publish. Do not introduce an incompatible category enum.
5. **Gender** — optional (e.g. Men/Women/Unisex).
6. **UK sizes** — editable multi-select/token input; normalized to the existing checkout size format; at least one unique size when publishing.
7. **Color** — optional.
8. **Description** — optional, plain text up to 2000 characters. This requires an additive Product schema field; do not silently assume it exists.
9. **Images** — upload multiple JPG/PNG/WebP; reorder, remove from the draft's gallery, select cover; show upload progress, errors, thumbnails, and alt text set by product name.
10. **In stock** — boolean; default false for incomplete drafts; must be true to publish.
11. **Status** — read-only Draft/Published indication (not an editable text field).

Two primary actions:
- **Save as Draft** saves current valid allowed fields and keeps `status: "draft"`; available for incomplete products.
- **Publish Product** validates every publishing requirement and sets `status: "active"` only on success. For an existing published record, **Save Changes** preserves `active`; **Unpublish** sets `draft` explicitly and requests confirmation.

A live preview uses the same helpers as storefront cards, displaying main image, name, brand, price, category, sizes, and non-interactive **Add to Bag**; draft preview never performs checkout. Show fallback placeholders and a visible Draft badge. Autosave is out of scope; warn on unsaved navigation.

## 4. Database contract

Extend the current Product schema **additively**:

| Field | Type | Meaning |
|---|---|---|
| `name` | String | Existing required. Draft saves must supply a non-empty name; see draft rule below. |
| `price` | Number | Existing required. Draft saves must supply a valid positive price; see draft rule below. |
| `brand`, `category`, `gender`, `color` | Strings | Existing optional fields. |
| `sizes` | [String] | Existing field; normalized UK sizes for checkout. |
| `image` | String | Existing cover URL; equals `images[0]` when gallery nonempty. |
| `images` | [String] | Existing gallery URLs in admin-selected order. |
| `inStock` | Boolean | Existing field; published product requires true. |
| `status` | String | Existing field. Manual `draft` or `active`. |
| `source` | Embedded object | Existing. Set `{provider:"manual"}` and omit `canonicalKey`, so the imported-record partial unique index does not collide. |
| `description` | String | **New optional** plain-text field; not currently used by public detail UI. |
| `managedImages` | Array of `{publicId, secureUrl}` | **New optional** Cloudinary ownership references, aligned to `images`; never expose deletion tokens. |
| `createdAt`, `updatedAt` | Dates | Existing automatic timestamps. |

**Draft/schema tension:** Existing `name` and `price` are required. To support genuinely incomplete drafts without weakening validation for imports, create a separate admin `ProductDraft` collection **or** allow drafts with nullable fields using schema conditional required rules. **Chosen implementation:** use conditional required validation based on `status` (required for `active`, optional for manual `draft`), plus explicit controller validation for published products; limit this relaxation to manual drafts and preserve imported product requirements. Do not inject fake names/prices. Confirm and test that required validator behaves correctly under create and update. For updates, validate the fully merged document before persisting; do not depend on partial Mongoose update validators alone.

**Legacy compatibility:** Imported records can omit `status`, `description` and `managedImages`; they must continue to render. Never backfill/import-refresh manually created products. Do not generate a `source.canonicalKey` for manual products unless a separate, stable manual SKU is later designed.

**Cloudinary removal:** Removing a managed image from a product updates the gallery immediately but deletes the remote asset only after there are no other references, or via a controlled cleanup job. Never delete imported/external URLs as if they were owned Cloudinary files.

## 5. API contract

All admin routes use the current `auth`, `requireAdmin`, and limiter. All JSON writes have strict field allowlists; never spread untrusted `req.body` into MongoDB updates. Responses use `{item}` or `{items,pagination}` and errors `{error,code,fields?}` following existing admin patterns.

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/admin/products?page=1&limit=20&search=&status=&source=` | Query; admin only | 200 `{items,pagination}` |
| GET | `/api/admin/products/:id` | MongoDB ObjectId | 200 `{item}` |
| POST | `/api/admin/products` | JSON fields; status omitted, server forces draft | 201 `{item}` |
| PATCH | `/api/admin/products/:id` | Partial editable fields; manual only | 200 `{item}` |
| PATCH | `/api/admin/products/:id/publish` | Empty JSON body; validate merged stored record | 200 `{item}` |
| PATCH | `/api/admin/products/:id/unpublish` | Empty JSON body; manual only | 200 `{item}` |
| POST | `/api/admin/products/images` | `multipart/form-data`, one file in `image` | 201 `{image:{url,publicId}}` |

Create/edit only accepts `name,price,brand,category,gender,color,sizes,inStock,description,images,managedImages` where managed metadata must be verified against server-issued upload ownership, not blindly trusted from the client. `status`, `source`, `currency`, `createdAt`, IDs, `retailer`, `productUrl`, `saleUrl` are never writable by the client. Server sets `currency:"GBP"`; `inStock` defaults false. Upload metadata must be tied to the admin session or a signed short-lived upload claim, ensuring one user cannot take over a guessed Cloudinary public ID. For gallery updates, accept ordered references to previously uploaded, session-owned images or existing images on that same manual product; server derives `image`, `images` and `managedImages` atomically.

Example create request (draft):
```json
{
  "name": "Nike Air Max 95",
  "price": 149.99,
  "brand": "Nike",
  "category": "Trainers",
  "gender": "Men",
  "sizes": ["7","8","9","10"],
  "inStock": true,
  "description": "Visible Air cushioning."
}
```

Publish response: `{item:{_id,name,price,currency:"GBP",status:"active",...}}`. Public GET contracts stay the same except filtering draft products.

Errors:
- 400 malformed JSON/object/invalid ID/unknown fields; 422 validation failure with field errors; 401 missing, expired or stale admin session; 403 non-admin; 404 missing record (or draft for public detail); 409 attempts to edit imported product or invalid conflicting state; 413 oversized upload; 415 unsupported image; 429 rate limit; 502/503 storage failure; 500 unexpected server failure.
- Apply small request size limits and escape regex search terms, cap page size as in existing controllers.
- Never echo credentials, raw upstream errors, or untrusted URLs in error bodies.

### Public visibility and downstream consumers

1. `GET /api/products`: append `status: {$ne:"draft"}` to all filter combinations (ensure test memory model supports `$ne`). This retains imported/legacy status-absent records. Explicitly unpublished manual products disappear.
2. `GET /api/products/:id`: return **404** for a draft, including if someone knows its ID. Admin detail endpoint can retrieve it.
3. `GET /api/hero-slides`: suppress slides associated with products in draft status; do not allow a draft to leak via public hero. Admin slide list may indicate unavailable/unpublished products.
4. Checkout continues to reject `status !== "active"` when present; ensure `source.provider:"manual"`, sizes, currency and price work through the existing checkout/order path.
5. Revisit client store/search/home grids to confirm they all use the public product endpoint, without a separate bypass of draft filtering.

## 6. Image upload and security

**Provider:** Cloudinary, via backend-signed/server-side uploads. This is a proposed integration. Secrets are configured through environment variables, never in browser JS or Git. Use a dedicated Escowear folder/prefix and random IDs.

Implementation contract:
- Use the already installed `busboy` for bounded multipart parsing and `sharp` for image decode/normalization; introduce Cloudinary's SDK only if needed and document the dependency/lockfile change.
- Authenticate and authorize **before** parsing the upload. Max **5 MB per image**, max **8 images per product**; only one image per request; cap request bytes while streaming. A 32 KB JSON body limit still applies to non-upload endpoints.
- Decode and validate actual file contents with sharp; accept JPEG/PNG/WebP only, strip metadata, normalize to WebP, cap dimensions/pixel count; reject decompression bombs, unsupported content and zero-length images. Do not trust filename, extension or Content-Type.
- Cloudinary upload uses server-held credentials; request `secure_url` and `public_id`; verify returned HTTPS host belongs to the configured Cloudinary domain/account. Never store binary in MongoDB.
- Reject unknown/non-owned image references; support an existing uploaded image still in the product. Allow replacement of a cover image by reordering the gallery. No raw arbitrary URL entry for manually uploaded images in v1.
- Rate-limit uploads more tightly than normal admin reads/writes; prevent unbounded storage by limiting uploads per product/session and clean up orphan uploads after a defined grace period (recommended 24h).
- On Cloudinary failures, do not create a partially uploaded image entry. If product save fails after upload, retain pending ownership for retry then orphan cleanup.
- Use remote image URLs only from the trusted uploaded records in manual product image galleries. Imported products retain their existing external image URLs.
- Cloudinary DNS/network access requirements and Docker environment configuration must be reviewed before production rollout; no live secrets or runtime changes in this spec.

## 7. Validation rules and invariants

**Draft:** Reject unknown fields, invalid types, oversized strings, unsafe/control characters, bad images, duplicate normalized sizes, negative/non-finite price and malformed image tokens. Omitted name/price are allowed only for `source.provider:"manual"` drafts under the conditional schema rule. If provided, name is 1–160 chars and price positive, at most two decimal places.

**Publish:** Require nonempty name (1–160), brand (1–100), category (1–80), price >0 with at most two decimal places, GBP currency, `inStock:true`, at least one unique valid UK size, at least one successful owned image, and a valid main image. Do not allow publishing incomplete draft. Product may be made `inStock:false` by editing an already published item (show sold out); changing active to draft is a separate unpublish operation. This is the one intentional difference between publish eligibility and subsequent stock changes.

**Edit:** Manual products only; immutable `_id`, `source`, timestamp, ownership metadata and importer fields. Revalidate full merged record. Reordering image gallery updates cover and image URLs together. Editing a published product must not silently convert it to a draft.

**Unpublish:** Mark `status:"draft"`; remove immediately from public catalogue and hero. Existing order snapshots remain intact. Show confirmation to admin and no hard deletion.

**Consistency/concurrency:** Use update preconditions (`updatedAt` or revision) to prevent two admin tabs silently overwriting each other. Reject stale updates with 409 and prompt refresh. Publish cannot race with a stale form save.

## 8. Suggested implementation boundaries

Backend:
- Add `server/controllers/adminProductsController.js`, `server/validators/adminProductValidator.js`, `server/services/productImageStorage.js`; optional image-upload router/middleware.
- Add routes and default Product injection to `server/routes/adminRoute.js`.
- Add `description`, `managedImages` and manual-draft conditional required rules to `server/Models/Product.model.js`.
- Update public draft exclusion in `server/controllers/productsController.js` and public hero in `server/controllers/heroSlidesController.js`.
- Add upload settings to one server config module; document env vars in `.env.example` or applicable setup docs. Do not put keys in Markdown.

Frontend:
- Add `client/src/Pages/AdminProducts/` list and form components, scoped CSS, and image upload adapter.
- Register routes in `client/src/App.js` and exports in `client/src/Pages/index.js`.
- Add Products link in `client/src/components/Header/Header.component.js`.
- Follow AdminHeroSlides' `AdminGate`, inline field errors, `apiRequest`, logout-on-401 and small-screen conventions.
- Adjust `apiRequest` or add a narrowly scoped multipart helper for file uploads: do **not** JSON.stringify `FormData` or set Content-Type manually; supply bearer auth.

No imported product migration, new dashboard, customer management UI, SKU system, per-size stock quantities, inventory decrement, product deletion, bulk importer edits, or dedicated product image editor in scope.

## 9. Acceptance criteria

- Admin can reach Products list, create a draft, revisit and edit it, upload/reorder/remove images, inspect live preview, publish, and unpublish.
- Anonymous users and customers cannot reach admin list/detail/create/edit/publish/unpublish/upload APIs.
- Missing/expired admin login is rejected. Client surfaces reauthentication.
- Saving an incomplete manual draft works; publishing it fails with field-specific errors until complete.
- Draft manual products never appear in public catalogue, product detail, public hero slides, or successful checkout; legacy/imported products still appear and are not accidentally filtered out.
- A published manual product is visible through `GET /api/products` and `GET /api/products/:id` with name, price, sizes, main image; eligible orders can use its ID and sizes.
- Only owned, validated Cloudinary images are attached. Invalid, huge, corrupt, or non-image files are rejected. Credentials are never returned or logged.
- Editing a manual product does not overwrite imported product source records, and stale concurrent edits are detected.
- Mobile layout usable at 320px+, keyboard navigable, accessible labels, clear upload feedback, sensible focus/errors and reduced-motion compliance.
- No unexpected changes to existing order, payment, hero admin or imported catalogue behavior.

## 10. Verification plan

Targeted tests (create new `server/tests/adminProducts.test.js`, plus relevant public product/hero and client tests):
1. Admin 201 create; GET list/detail; 200 patch; publish/unpublish transitions; error codes and field-level validation.
2. Auth 401, 403, stale-session rejection for every new route, including image uploads.
3. Draft without name/price persists under conditional Mongoose requirements, but other product types keep original validation; update validation uses merged document.
4. Public list pagination/search and public detail exclude draft; missing status remains visible; no data migration.
5. Hero public endpoint excludes slides pointing at unpublished products.
6. Checkout rejects a draft and allows a valid published manual product; verifies GBP and normalized sizes.
7. Upload JPG/PNG/WebP success and image order/cover mapping; rejects oversized, malformed, polyglot, invalid mime/bytes, non-owned references, excessive upload count; Cloudinary failure and orphan recovery.
8. Duplicate submissions, unknown fields, invalid ObjectIds, injection-looking input, conflicting edits.
9. Client form validation, upload progress/errors, Save Draft, Publish and mobile preview with mocked server.

Commands consistent with repository:
- `npm run test:server`
- `CI=true npm test --prefix client -- --watchAll=false`
- `npm run build --prefix client`
- Existing E2E smoke if UI integration warrants it.
No test or deployment is claimed by authoring this specification.

## 11. Rollout, risks and operations

1. Configure Cloudinary server credentials and folder prefix with masked secrets, verify network access in the production Docker environment, and define orphan cleanup/retention before allowing uploads.
2. Deploy additive schema/API and draft-safe public filtering together so drafts cannot leak; test against imported fixtures before rollout.
3. Roll out admin interface after server support, behind existing admin auth. Verify actual hosted site through smoke tests after separately approved deployment.
4. Roll back by disabling new admin routes/UI; keep stored manual products as-is. If rolling back public filtering, make sure draft data does not become publicly accessible; an unguarded rollback would expose drafts. Preferred rollback keeps draft filter active until draft records are safely addressed.
5. Monitor storage failures, upload rate and validation errors without logging image payloads/secrets.

## 12. Implementation readiness and remaining decisions

This document is a **proposed technical specification**, not proof of implementation. The product behavior is specified above. Implementation readiness additionally depends on:
- Cloudinary account, billing/limits, configuration and storage policy being approved and available. This spec does not provision accounts or secrets.
- Confirming whether a separate product description should be displayed on the customer detail page. This spec stores description but leaves storefront detail design unchanged until explicitly approved.
- Verifying existing local and production import behavior against a representative database snapshot, including `status` values and category strings, before rollout.
- Confirming how incomplete draft validation interacts with existing importer tests and MongoDB model validation.

**No code, database, image-storage configuration, deployment or production environment has been changed by this document.**
