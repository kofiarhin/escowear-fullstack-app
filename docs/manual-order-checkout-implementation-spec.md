# EscoWear — Guest Checkout, Manual Payment and Order Tracking
**Implementation specification v1.0 — 19 October 2026**  
**Status:** Proposed, not implemented or approved for deployment.  
**Repository:** `kofiarhin/escowear-fullstack-app` (`master` inspected 19 October 2026).  
**Supersedes for checkout/order workflows:** `docs/escowear-mvp-prd.md` and `docs/escowear-mvp-technical-spec.md`, which describe payment-provider checkout and account-required orders. Their unrelated catalogue/sourcing principles remain useful.  
**Scope:** Customer product-to-cart-to-order, guest checkout, manual bank-payment communication, administrator verification, fulfilment, customer tracking, notification and security; no payment gateway.

## 1. Goal and definition of done
A visitor can select an actual sneaker size and quantity, keep and edit a cart, submit an order without registering or paying, receive a durable order reference and acknowledgement, and securely track its progress. An authenticated authorized administrator can inspect the order, agree and send a final Ghana-cedi payment quote by email, record evidence of a bank transfer received after customer emails a screenshot, confirm only after independently verifying the funds, source and dispatch the goods, and keep the customer informed. Failures and exceptions are recoverable and audited.

**Non-goals:** In-app payment processing, payment gateway/webhooks, uploading proof inside the store, automatic reading of payment screenshots/emails, automatic bank reconciliation, automatic supplier purchases, automatic courier integration, loyalty, subscriptions and forced registration.

**Source of truth:** Order and payment verification state resides in MongoDB; email is communication, never proof of payment. The customer screenshot is emailed to the business outside the app. The admin verifies actual bank receipt before confirming an order.

## 2. Verified baseline and gaps
Reviewed existing repository files: `client/src/App.js`, `client/src/Pages/Details/Details.page.js`, `client/src/Pages/Cart/Cart.page.js`, `client/src/Pages/Dashboard/Dashboard.page.js`, `client/src/components/OrderList/OrderList.component.js`, `client/src/components/Header/Header.component.js`, `client/src/utils/product.js`, `server/Models/{Order,Product,User}.model.js`, `server/controllers/ordersController.js`, `server/routes/ordersRoute.js`, `server/middlewares/auth.middleware.js`, `server/server.js`, `client/src/App.test.js`, `deploy/beast/auth-orders-smoke.cjs`, and `README.md`.

- Existing routes: `/`, `/store`, `/details/:id`, `/cart`, `/login`, `/register`, `/dashboard`, `/logout`. Retain their URL compatibility.
- Product details list sizes but do not provide an active size selection. Adding a product puts the entire product document into `sessionStorage.cartData`, without quantity.
- Cart can remove/clear but computes total as sum of client-supplied product prices; `Cart` expects a `user` prop not supplied by `App`. Place Order requires that prop, posts raw cart data, clears cart regardless of API response status and redirects to dashboard.
- `POST /api/orders` and `GET /api/orders` require JWT authentication; the create controller persists `req.body` products without server-side pricing/availability checks. Order schema has only user, products and status; API returns only a creation message.
- `/dashboard` has its order-loading effect commented out; there is no checkout, guest tracking, email system, admin authorization or admin order console in inspected source.
- Product prices default GBP; home copy says customers pay in GHS and sourcing happens after payment. Imported supplier stock is advisory, not guaranteed.
- Existing isolated auth/orders smoke test uses in-memory models and does not prove real DB checkout or current production behavior.
- Repository README indicates Beast deployment and a production MongoDB database; this document does not certify current production state, secrets, backups or migrations.

## 3. Business policy / proposed decisions
1. **Guest checkout is the default.** Registered customers may sign in optionally and link their own orders by verified email. Accounts are not required to buy or track.
2. **Place order before payment.** Submission creates an unpaid request, not a confirmed purchase or payment obligation. Customer sees “Order received — awaiting our email”; not “Paid” or “Confirmed.”
3. **Admin first checks exact supplier size availability and final amount.** Catalogue displays GBP prices. Order snapshot includes GBP product prices; final payable GHS amount (including shipping, fees, customs assumptions and quote expiry) is proposed by an admin and explicitly sent/accepted via payment instructions before any transfer. Never silently charge/reprice.
4. Customer transfers funds externally using admin-provided bank details and order reference, and replies to the instruction email with a screenshot (or contacts support). The app contains neither bank credentials nor screenshot upload on the customer side.
5. Admin independently matches bank transaction amount, reference and account receipt; a screenshot alone is **never** verification. Admin records manual verification metadata and an audit event, then approves the order and emails the customer.
6. Admin manually purchases from a verified UK retailer and dispatches to Ghana. If unavailable before payment, seek customer agreement or cancel the unpaid request. If paid and sourcing fails, flag refund resolution and handle according to approved legal policy; do not mark it fulfilled.
7. Make email acknowledgement automatic after durable creation. Manual payment instruction originates from an admin action and uses an editable, audited template. Confirmation/dispatch emails should be automated following successfully committed status changes, with safe retries.
8. **Explicit decision required before implementation:** exact bank/payment channel, final-GHS calculation and expiry policy, shipping/duty responsibility, return/refund rules, administrator provisioning, email sender/provider, retention and guest tracking expiry. Default implementation must not insert real bank details or invent conversion rates.

## 4. End-to-end customer and admin sequence
1. Customer navigates `/store` → `/details/:id`, chooses one available size and quantity (default 1; max enforced). Unavailable/no-size products cannot be ordered.
2. Add-to-cart merges same `productId + size` quantities without duplicating lines; different sizes are separate lines. Show cart count and feedback.
3. `/cart` supports quantities, removal, clear, line totals, GBP indicative subtotal, stock warning and “Continue to checkout.” Cart survives refresh and browser restart using versioned `localStorage` (no sensitive personal data).
4. `/checkout` supports guest by default and optional login. Require customer name, valid email, Ghana phone, recipient, delivery street/landmark, city and region; show order items, provisional GBP total and clear notice: **No payment now. We will email confirmed GHS payment details after checking availability and costs.** Require agreement to published terms/privacy.
5. `POST /api/orders` takes normalized items (product ID, size, qty), customer and address, terms version and idempotency key. Server re-reads products, validates size and availability hint, snapshots immutable product identity and current GBP unit prices, computes totals, generates collision-safe public order number and saves one `pending_contact` order. In the same durable workflow schedule an acknowledgement email. Response includes order ID, public number, status and a restricted tracking handoff; do not return an admin secret.
6. `/orders/:id/confirmation` shows received order, public number, items, indicative GBP subtotal, contact email and expected next step. Clear the cart **only after verified 201 success**; retrying after network uncertainty uses the same idempotency key and does not create another order.
7. Admin at `/admin/orders` opens `/admin/orders/:id`, checks availability, contacts customer, enters final quote amount in integer GHS pesewas, breakdown, validity time, contact notes and reference, then sends payment-instruction email. After a successful send/queued attempt, order moves to `awaiting_payment` with accurate email delivery state.
8. Customer pays outside EscoWear and replies by email with screenshot; the business mailbox retains that external attachment. Admin records payment-under-review and internal note (no attachment upload/storage required).
9. Admin verifies cleared receipt in the actual bank/payment account, then records exact amount, transaction reference, verified timestamp and admin ID. Only permitted transition marks payment `verified` and order `confirmed`; trigger confirmation email.
10. Admin progresses `processing` → `dispatched` → `delivered` → `completed`; record retailer purchase/fulfilment info, carrier, tracking number and shipment history where available; notify the customer.
11. Guest follows the emailed tracking link or uses `/track-order` with an order number + email **and one-time emailed code**; rate-limit, expire and scope session to a single order. `/orders/:id` shows safe progress and status history. Registered users can see only their own linked orders under `/dashboard`.
12. Payment discrepancy, expiry, supplier unavailable, customer cancellation, email outage and delivery exception follow explicit admin action paths and messages; never silently auto-confirm or auto-refund.

## 5. Screens and routes
| Current/new | Route | Features | Access |
|---|---|---|---|
| Keep | `/` | Home, explain manual payment honestly | Public |
| Keep | `/store` | Search, filter, page products | Public |
| Enhance | `/details/:id` | Select size, qty, unavailable state, add to cart | Public |
| Enhance | `/cart` | Edit, totals, persist, checkout CTA, empty/error | Public |
| New | `/checkout` | Customer + Ghana address, summary, agreement, submit | Public |
| New | `/orders/:id/confirmation` | Successful received-only confirmation; secure scoped access | Order owner/guest token |
| New | `/track-order` | Request OTP by order number + email; avoid account enumeration | Public |
| New | `/orders/:id` | Order status, safe delivery progress; no admin notes | Verified order viewer |
| Keep/enhance | `/login`, `/register`, `/dashboard` | Optional account/order history | Auth customer |
| New | `/admin/orders` | Paginated search, status filters, outstanding actions | Admin only |
| New | `/admin/orders/:id` | Quotes, send instructions, verify payment, fulfil and audit | Admin only |

Use proper navigation, keyboard accessibility and mobile layouts. Avoid PII or tracking tokens in analytics. Do not expose a full order just because the URL contains its ID.

## 6. Data and migration (MongoDB/Mongoose)
**Extend existing models, preserve backwards compatibility.** Existing `Order.products` and `Order.user` records may exist; support legacy orders in read paths or safely migrate after a reviewed backup. New orders use `items` snapshots; no destructive rename without verified data assessment.

### `orders` (extend)
- `orderNumber: String` unique, immutable, human-readable, unpredictable enough to avoid enumeration; use DB-safe counter/UUID encoding with unique index.
- `user?: ObjectId` optional; `customer: { name, emailNormalized, phone }`; `shippingAddress: { recipient, phone, line1, line2?, city, region, country:'GH', landmark? }`.
- `items: [{ productId, skuOrSize, name, brand?, image?, size, quantity, unitPriceGBPMinor, lineTotalGBPMinor, retailerSnapshot? }]`. Product reference and values are immutable once submitted; quantity positive safe integer. Supplier stock remains unverified until admin checks.
- `pricing: { currency:'GBP', subtotalGBPMinor, estimatedOnly:true, finalGHS?: { subtotalMinor, feesMinor, shippingMinor, dutiesMinor, totalMinor, rateSnapshot?, quoteVersion, quotedAt, expiresAt, agreedAt? } }`; no double-floating money.
- `status` enum; `payment: { method:'manual_transfer', status, reference?, amountReceivedGHSMinor?, verifiedBy?, verifiedAt?, reviewNote? }`; `fulfilment: { supplierReference?, purchaseRecordedAt?, carrier?, trackingNumber?, dispatchedAt?, deliveredAt? }`.
- `email: { acknowledgementState, paymentInstructionState, confirmationState, lastError? }`; `termsVersion`, `source`, `createdAt`, `updatedAt`; internal/admin notes separate from public serialization.
- Index `orderNumber` unique, `customer.emailNormalized + createdAt`, `user + createdAt`, `status + createdAt`; retention policy must be confirmed.

### `orderEvents` (new)
`{orderId, actorType:'system'|'admin'|'customer', actorId?, type, fromStatus?, toStatus?, sanitizedDetails, createdAt}` with index `orderId+createdAt`. Append-only, never put screenshot bytes, credentials or bank account numbers in events.

### `emailOutbox` (new)
`{orderId, kind, to, templateVersion, payloadSafe, state:'queued'|'sending'|'sent'|'failed', attempts, nextAttemptAt, providerMessageId?, lastError?, createdAt, sentAt?}`. Unique deterministic event/template key to prevent duplicate messages. Queue reliably via DB outbox atomically with order state where supported; otherwise document reconciliation and recovery. Retry transient send failures with bounded backoff, expose failures to admin.

### `users` (extend)
Keep current schema; add `role:'customer'|'admin'` default customer, ensure no public request can set admin. Existing registered users may attach eligible orders only after verified email control. No requirement to create an account for orders.

### `products`
Keep existing catalogue schema. Verify `sizes[]`, `price`, `currency`, `inStock` and supplier availability. Do not promise real-time UK retailer inventory; re-confirm manually prepayment.

### `carts` (optional later)
MVP guest cart uses client-side local storage only and server validates on checkout; server-side registered-cart sync can be deferred.

### Migration safeguards
Add optional fields and indexes non-destructively. Investigate legacy orders and DB indexes before migration; backup and rehearse restoration before production writes. Reject unsafe fallback prices; never auto-mark old `Pending` orders paid. Do not expose secret/customer fields in public JSON.

## 7. State machines and access rules
**Order status:** `pending_contact` → `awaiting_payment` → `payment_review` → `confirmed` → `processing` → `dispatched` → `delivered` → `completed`.
Exception states: `awaiting_customer` (availability/quote query), `payment_issue` (rejected/disputed proof), `sourcing_failed`, `refund_pending`, `refunded`, `cancelled`. Define legal transitions explicitly in a central service; admin actions require valid expected prior state (optimistic concurrency), actor and an audit event.

**Payment status separate from fulfilment:** `not_requested`, `awaiting_payment`, `under_review`, `verified`, `rejected`, `refund_pending`, `refunded`. Status `confirmed` requires verified payment; only privileged, audited admin action can set it. Do not enable a status dropdown to bypass those invariants.

**Role/access matrix:** Anonymous can create orders and request OTP but cannot list orders. Verified guest may view only one sanitized order for limited time. Logged-in customer may view only linked orders. Admin may search and modify orders via separate role-checked endpoints. Exclude bank details, internal notes and private proof emails from guest views.

## 8. Proposed HTTP API (retain existing `/api` prefix)
- `POST /api/orders` public: validated guest order create; rate limit and idempotency header; 201 response `{orderId,orderNumber,status,trackingHandoff}`.
- `GET /api/orders` authenticated: current customer's orders (fix existing handler); paginated and ownership-filtered.
- `GET /api/orders/:id` authenticated owner or verified guest scoped token: sanitized summary.
- `POST /api/orders/tracking/request` public `{orderNumber,email}`: same generic response for found/not found; rate-limit/email OTP.
- `POST /api/orders/tracking/verify` public `{orderNumber,email,code}`: short-lived order-only session/token. Store OTP hashes, TTL, attempts; prevent brute force, replay, enumeration.
- `GET /api/admin/orders` admin: paginated filters and search, including order reference and status.
- `GET /api/admin/orders/:id` admin: detailed order, payment and activity history.
- `POST /api/admin/orders/:id/payment-instructions` admin: validate availability, quote, expiry and email settings; queue audited contact message; idempotent.
- `POST /api/admin/orders/:id/payment-review` admin: mark that customer proof arrived via external email; optional reference/note.
- `POST /api/admin/orders/:id/verify-payment` admin: require received amount, bank transaction reference, actual receipt attestation, actor; guarded transition.
- `POST /api/admin/orders/:id/payment-issue` admin: reject/request correction without destroying history.
- `POST /api/admin/orders/:id/fulfilment` admin: permitted sourcing/processing/dispatch/delivery action and carrier details.
- `POST /api/admin/orders/:id/cancel` admin: reason and audit; refund workflow if paid.

Never accept `status`, user ID, item price, payment verified or admin role as trusted public-input authority. Use consistent 400/401/403/404/409/422/429 error contracts. Capture request IDs, sanitize logs, enforce max body sizes. Explicit authorization tests for every endpoint.

## 9. Email contract and manual operations
1. **Received:** Send to customer after accepted order. Subject “EscoWear order received — #<number>”. Summarize items, indicative amount, address and next step, with secure tracking link. Clearly state not yet paid/confirmed.
2. **Payment instructions:** Admin-triggered, after confirming supplier availability and payable GHS quote. Include amount, expiry, bank account/payment channel configured securely, reference, deadline, and instruction to **reply to email with payment screenshot**. Include support contact and what happens if quote expires. Never hardcode bank details in committed source. Admin sees send state/attempt history.
3. **Payment issue:** Admin-triggered email explains next action without disclosing sensitive account data.
4. **Confirmed:** After bank receipt manually verified, show order number, amount recorded and sourcing next step.
5. **Progress:** Update when processing, dispatched (carrier/tracking if available), delivered, cancelled/refunded.
Email sending should not roll back a properly saved order on provider outage. Failed email remains queued/flagged for retry and admin action; no duplicate customer orders. Store provider IDs and template versions; no raw screenshot in database.

## 10. Implementation slices and affected files
**Slice A — cart/product correctness:** Edit `client/src/Pages/Details/Details.page.js`, `client/src/Pages/Cart/Cart.page.js`, header, product utilities and associated styles; add small reusable cart storage/state helper and focused tests. Size selector/qty validation, merge-by-variant, persisted cart, safe parsing, editable cart, stock messaging, GBP subtotal.

**Slice B — guest order creation:** Edit `server/Models/Order.model.js`, `server/controllers/ordersController.js`, `server/routes/ordersRoute.js`; add validators and order service. Implement server-side catalogue validation and price snapshots, idempotent order creation, reference generation, provisional-vs-final currency distinction, persistence and API tests; preserve current authenticated GET behavior.

**Slice C — checkout UI/confirmation:** Add `client/src/Pages/Checkout/`, `client/src/Pages/OrderConfirmation/`, route declarations in `client/src/App.js`, UI tests. Handle input validation, terms, processing/error/retry, inaccessible order handling; empty-cart and stale-price correction without losing entries.

**Slice D — mail and admin:** Extend `server/Models/User.model.js` for protected admin role; add `OrderEvent` and `EmailOutbox` models, admin middleware, email transport/service, status/quote logic and admin routes/controllers. Add `client/src/Pages/AdminOrders/` and `AdminOrderDetails/`. Enforce admin RBAC, proper bank receipt verification, audit, email errors, allowed status transitions. Secure admin bootstrap procedure is an explicit precondition.

**Slice E — tracking/history and fulfilment:** Add OTP-backed guest order lookup and scoped auth, `client/src/Pages/TrackOrder/`, `OrderDetails/`, update `Dashboard.page.js` and order list, implement customer-visible shipment/status history and email notifications.

**Slice F — end-to-end hardening:** Add backend service/API tests, React component tests and Playwright browser smoke where suitable. Run mobile/desktop accessibility and duplicate/error cases. Resolve release prerequisites before any production migration/deployment.

Follow existing React 18/CRA, Redux, Express 4, Mongoose 6 structure; don't introduce TS migration, ORM, payment SDK, microservices or unrelated refactors. New email/validation/rate-limit dependencies must be justified and separately approved in execution plan.

## 11. Test and acceptance matrix
- **AC01:** Valid available product requires chosen size; qty min 1/max bound; unavailable items cannot be ordered.
- **AC02:** Duplicate same-size cart additions merge; different sizes remain separate; updates survive refresh/new tab; bad stored JSON safely resets.
- **AC03:** Guest reaches checkout without login and sees explicit no-payment and indicative GBP vs final GHS messaging.
- **AC04:** Required address/contact/terms validated; invalid fields do not create orders; sensitive input protected.
- **AC05:** Server rejects price tampering, invalid product IDs, missing sizes, unavailable items, invalid quantities; correct GBP snapshot persisted.
- **AC06:** Duplicate click/retry with same idempotency key creates one order and one acknowledgement job.
- **AC07:** API errors preserve cart; success returns durable number and received-only confirmation.
- **AC08:** Admin endpoints deny guest/customer/non-admin; admin actions audited with timestamp/actor.
- **AC09:** Admin can send a final GHS quote and email payment instructions using configured account details; expiry/requote handled; no gateway or customer upload.
- **AC10:** Screenshot/claim alone cannot set payment verified; verified bank receipt action records amount, reference and actor; only then confirmed status and email.
- **AC11:** Illegal transitions and concurrent updates rejected; retries never send duplicate confirmation/purchase records.
- **AC12:** Guests can track only their own order after email code; invalid/expired/reused code denied; no account enumeration.
- **AC13:** Registered customers see only their own orders; existing login/register/catalogue routes still function.
- **AC14:** Shipping status, tracking ID, delivery updates and exceptional cancellation/payment issue visible as appropriate; admin-only notes hidden.
- **AC15:** Email provider outage does not lose an accepted order; queued mail retries and failures are visible.
- **AC16:** Legacy orders still read safely; migrations and backups validated; admin cannot silently rewrite confirmed price/history.
- **AC17:** Mobile and desktop flows, loading/empty/validation/error/success states, accessible controls and no unexpected console/network errors verified.

**Repo-defined checks at specification time:** `npm run test:server`, `npm run test:importer`, `CI=true npm test --prefix client -- --watchAll=false`, `npm run build --prefix client`. Extend server test script to include new order/admin/tracking suites during implementation; perform integration/E2E in isolated test DB. No tests were run to create this document.

## 12. Release gates and operational dependencies
- Do not deploy before explicit approval. Check actual Beast runtime separately from GitHub; record versions and back up and restore MongoDB before schema/data writes. Existing README notes backup/recovery was deferred.
- Review secret hygiene/history and rotate any exposed credentials before production; never commit bank info, SMTP credentials, JWTs or database URIs.
- Configure email domain/provider with SPF/DKIM/DMARC, verified sending identity and support reply-to mailbox. Confirm operational access to bank payment verification outside the app.
- Establish an authorized admin identity and role-provisioning method without public privilege escalation; validate CSRF strategy for sessions and rate limits for anonymous APIs.
- Confirm Ghana delivery/region rules, currencies and fee ownership; define legal/customer terms, cancellations, refunds, import duties, retention/GDPR compliance.
- Test end-to-end with fake addresses/emails in staging, mocked mail and no real money: submit → acknowledgement → admin quote → instructions → simulated proof received → manual verification record → sourcing → dispatch → tracking → delivered.
- No PR, merge or production release implied by this specification.

## 13. Decisions outstanding before execution
**D1:** Final payable GHS rate/fee/shipping calculation and quote validity (recommended: admin sets and explicitly approves final quote before email).  
**D2:** Which receiving account/channel and reply-to mailbox are supported; keep all credentials/private details outside repo.  
**D3:** SMTP/API mail provider, retry strategy and deployment secrets.  
**D4:** Admin provisioning and authorized staff accounts.  
**D5:** Ghana address requirements, taxes/duties, cancellation/refund and payment-exception policy.  
**D6:** How long orders, tracking tokens, audit events, transactional mail metadata and personal addresses are retained.

**Next action:** Review/approve D1–D6, then create small tracked tickets for slices A–F; implementation is not authorized by saving this specification.
