# Escowear | Technical Specification

## Architecture, data models, APIs, workflows and tests

Draft v1.0 | 17 October 2026 | Planning only — not implemented or approved for production

Document basis: Escowear decisions in this conversation; GitHub repository structure inspected on 17 October 2026. Proposed functionality is not a claim of implementation.

## 01 Architecture and current baseline
Existing public repository: kofiarhin/escowear-fullstack-app, default branch master. Verified folder roots client/ and server/, React/Redux and Express/Mongoose structure. Current master root package.json has no implemented root test command (it exits with error). Feature branch feature/escowear-sneaker-import was not found in GitHub at document time; earlier locally reported 3,258 imported sneakers are not independently verified in published branch.

## 02 System boundaries
React customer/admin UI → Express /api/v1 HTTP API → MongoDB (products, users, carts, quotes, orders, payments, shipments, suppliers, settings, audit events). External payment service via hosted/embedded checkout, signed webhook callbacks. Admin interacts with UK supplier sites and Ghana logistics manually; no automatic supplier purchase API.

## 03 Customer surface
Home: hero “Authentic sneakers. Delivered to Ghana.” with curated products and How It Works. Shop: search, category, brand, size and sort; paging. Product: media, variants, GHS price guidance, supply status, delivery estimate and source disclaimer. Cart: products/sizes/quantity. Checkout: verified quote, Ghana address, payment. Confirmation/Tracking: order reference and latest verified status.

## 04 Admin surface
Products: import and normalize supplier records, deduplicate by source URL, map sizes, inspect images, set publish flags, update prices. Orders: payment proof, verify supplier availability, record purchase reference and cost, add shipment/tracking, issue exception/refund updates. Restrict admin routes by role and audit changes.

## 05 MongoDB collections — users
_id, email unique, passwordHash, name, phone, role(customer/admin), addresses[{id, recipient, phone, region, city, street, landmark, country:GH}], createdAt, updatedAt. Store passwords only as strong hashes. Account ownership required for orders.

## 06 MongoDB collections — suppliers
_id, name, website, country:UK, approved, notes, createdAt, updatedAt. Sourcing allowed only from approved suppliers.

## 07 MongoDB collections — products
_id, name, brand, category, description, images[], variants[{sku,sizeSystem,size,availableHint}], supplierId, supplierProductUrl unique per supplier, costGBPMinor, displayPriceGHSMinor (indicative), availability(unverified/available/unavailable), published, featured, lastCheckedAt, createdAt, updatedAt. Do not mistake imported catalog availability for guaranteed stock.

## 08 MongoDB collections — carts
_id, userId, items[{productId,variantSku,quantity}], updatedAt. Product price must never come from browser cart data.

## 09 MongoDB collections — quotes
_id, userId, items snapshot with quantities, currency:GHS, subtotalGHSMinor, sourcingFeeGHSMinor, shippingGHSMinor, dutiesGHSMinor, totalGHSMinor, exchangeRateSnapshot, rulesVersion, expiresAt, status(active/expired/used), addressRegion. Quote calculated on server; recheck before payment.

## 10 MongoDB collections — orders
_id, orderNumber unique, userId, quoteId, items snapshot{name,brand,size,quantity,unitPriceGHSMinor,supplierId,sourceUrl}, address snapshot, totals snapshot, currency:GHS, paymentStatus(unpaid/pending/paid/refund_pending/refunded/partially_refunded), fulfilmentStatus(pending_payment/paid_pending_sourcing/sourcing/purchased/shipping/out_for_delivery/delivered/sourcing_failed/cancelled), timestamps, statusHistory[]. Store snapshots for auditability.

## 11 MongoDB collections — payments
_id, orderId, provider, providerReference unique, amountGHSMinor, currency:GHS, status(initialized/pending/success/failed/refund_pending/refunded), verifiedAt, webhookEventIds[], refundReference. Never store raw card data or provider secrets in MongoDB.

## 12 MongoDB collections — shipments
_id, orderId, provider/carrier, trackingNumber, status(preparing/in_transit/customs/out_for_delivery/delivered/exception), events[{status,location,description,occurredAt}], estimatedDeliveryDate, dispatchedAt, deliveredAt. For multiple items, support shipment item IDs as needed.

## 13 MongoDB collections — settings/audit
settings: exchangeRateGBPtoGHS, pricing rules, sourcing fee, shipping rate table, customs estimate policy and effective time. auditEvents: actorId, action, target, timestamp, sanitized details. Money stored in integer minor units; rates in fixed-precision decimal or controlled string representation.

## 14 API — auth and profile
POST /auth/register; POST /auth/login; POST /auth/logout; GET /users/me; PATCH /users/me; GET/POST /users/me/addresses. Auth cookie/session or bearer token strategy must be consistent, secure and tested.

## 15 API — catalogue
GET /products?page=&search=&brand=&category=&size=&sort=; GET /products/featured; GET /products/filters; GET /products/:id; GET /suppliers (optional customer-facing; limit private supplier details). Pagination server-side, only published products publicly.

## 16 API — cart
GET /cart; POST /cart/items; PATCH /cart/items/:itemId; DELETE /cart/items/:itemId. Check variant and quantity server-side.

## 17 API — checkout/payments
POST /checkout/quote; POST /checkout (atomic create pending order from active quote); POST /payments/initialize; GET /payments/:id/status; POST /webhooks/payments. Webhook authenticates provider signature, checks amount/currency/order/reference, deduplicates events and applies status transition once. Client callback alone cannot confirm payment.

## 18 API — orders
GET /orders; GET /orders/:id; GET /orders/:id/tracking; POST /orders/:id/cancel-request. All reads scoped to authenticated customer; expose sanitized tracking only.

## 19 API — admin
GET/POST /admin/products; PATCH /admin/products/:id; PATCH /admin/products/:id/publish; POST /admin/products/import; GET /admin/orders; GET /admin/orders/:id; PATCH /admin/orders/:id/status; POST /admin/orders/:id/purchase; POST /admin/orders/:id/shipment; PATCH /admin/shipments/:id; POST /admin/orders/:id/refund; GET/PATCH /admin/settings/pricing; GET /admin/dashboard.

## 20 API conventions
Versioned /api/v1 endpoints, {data,meta,error} envelope; validation errors 400/422, unauthenticated 401, forbidden 403, missing 404, conflict 409, expired quote 410/409 (choose convention), rate limit 429. Request IDs on logs. Idempotency key on checkout/payment/refund/sourcing writes; pagination and filters validated.

## 21 State transitions
Order: pending_payment → paid_pending_sourcing → sourcing → purchased → shipping → out_for_delivery → delivered. Exceptional: payment_failed (payment status), sourcing_failed → refund_pending → refunded, cancelled. Only authorized transitions; purchased cannot be repeated. Keep payments, fulfilment and shipment as separate states.

## 22 Sourcing flow
Admin sees paid order, rechecks exact SKU/size/price, purchases from approved UK supplier, records retailer reference, cost and purchase timestamp; if not found records exception, contacts customer and uses accepted alternative or refund. No supplier purchase before verified payment under default flow.

## 23 Refund flow
Customer submits cancellation/support request. Before retailer purchase: full refund. Failed sourcing: full refund. After purchase/wrong/damaged: operator applies policy and law. Admin uses provider API to refund; refund record and order status update on verified provider result. Prevent duplicate refunds and over-refunds.

## 24 Security and compliance
Secrets in environment only and ignored by Git; rotate any historically exposed credentials. Limit personally identifying information, validate address input, role-based access checks, enforce ownership, rate limit login and write endpoints, verify payment webhooks, protect CSRF where cookies used, store sanitized audit trails, configure backups and privacy retention. Regulatory/legal compliance requires review before launch.

## 25 Testing — unit
Price formula, currency integer maths, quote expiration, status transitions, SKU mapping, cancellation eligibility, fee rounding, idempotency keys and validation.

## 26 Testing — API integration
Published-only products and filtering; cart ownership; expired quote rejection; server price tampering rejection; mock provider init; signed/unsigned/repeated/out-of-order webhooks; duplicate payment attempts; wrong order access 403/404; admin-only mutations; repeated retailer purchase rejection; sourcing failure/refund; tracking history.

## 27 Testing — browser E2E
Home→Shop→Product size→Cart→GHS quote→Ghana checkout→sandbox payment→confirmation→tracking; mobile responsive; invalid addresses; empty states and image fallbacks. Full fulfilment simulated from admin interface.

## 28 Observability and release
Structured logs with request/order IDs, sanitized webhook errors, admin audit, failed payment alert, stuck sourcing queue, shipment exceptions, backups and restore drill. No production approval until critical tests, payment reconciliation, supplier/legal/fulfilment rules, secret rotation and manual end-to-end exercise complete.

## 29 Proposed repository structure
Preserve existing client/ and server/. Gradually add client/src/pages, components, services, state; server/models, routes, controllers, services/{pricing,sourcing,payment,shipping}, middleware, validators, importers, tests; e2e/; docs/; scripts/. Avoid full rewrite or premature mass renames.

## 30 Acceptance criteria
AC01 Published catalogue loads from database, search and pagination work. AC02 Customer picks size and sees GHS total and delivery estimate before payment. AC03 Server ignores user-supplied prices. AC04 Verified payment creates exactly one paid order. AC05 Admin can record exactly one retailer purchase per sourcing action. AC06 Customer tracks verified fulfilment events. AC07 Failed sourcing leads to full refund workflow. AC08 Customer cannot access other customers’ orders. AC09 Admin endpoints enforce role. AC10 Critical automated tests and sandbox end-to-end run pass.

## 31 Dependencies and decisions to resolve
Payment provider and payment methods (recommended mobile money + cards), checkout account policy, real pricing and customs treatment, courier and customer delivery regions, cancellation after UK purchase, operational refund process, supplier terms/licensing for product images and listing data, and any legal requirements. These are not treated as finalized decisions.
