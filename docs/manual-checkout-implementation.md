# Manual checkout — implementation notes

Implements the proposed [manual order checkout specification](https://github.com/kofiarhin/escowear-fullstack-app/blob/docs/manual-order-checkout-spec-20261019/docs/manual-order-checkout-implementation-spec.md) (19 October 2026). This page records what was actually built, how to operate it, and which business decisions are still open. **Nothing here is approved for production yet.**

## Open business decisions (not invented in code)

| ID | Decision | How the code handles it until decided |
|---|---|---|
| D1 | GHS rate, fees, shipping, quote validity | No rate or fee rules in code. An admin enters every final GHS amount (in pesewas) and the expiry by hand. |
| D2 | Receiving bank/payment channel and reply-to mailbox | No bank details in source. Payment instructions only render from the private `ESCOWEAR_PAYMENT_INSTRUCTIONS` env value, and the action is refused if it is unset. |
| D3 | Mail provider, sender, secrets | No provider package. Mail goes into a durable `emailoutboxes` queue. With the default `EMAIL_TRANSPORT=none`, messages stay queued and visible to admins; nothing is sent. |
| D4 | Admin identities | Admins can only be granted with the operator CLI (`npm run admin:set-role`), never through the API. |
| D5 | Ghana delivery, duties, refund policy | Only the address fields are validated (16 regions, Ghana phone format). Refunds are recorded by hand; nothing is automatic. |
| D6 | Retention of orders, mail and audit PII; token lifetimes | Nothing is deleted automatically. Token and code lifetimes below are provisional defaults set by env. |

Terms and privacy wording is also undecided. The checkout records `termsVersion` (`REACT_APP_ORDER_TERMS_VERSION`, default `draft-2026-10`) and links to no published policy yet.

## Guest order API (IDE-114)

`POST /api/orders` is public. It needs an `Idempotency-Key` header (16–128 characters `[A-Za-z0-9_-]`) and accepts an optional customer bearer token.

```json
{
  "customer": { "name": "…", "email": "…", "phone": "0241234567" },
  "shippingAddress": { "recipient": "…", "phone": "…", "line1": "…", "line2": "…", "landmark": "…", "city": "…", "region": "Greater Accra" },
  "items": [{ "productId": "<24 hex>", "size": "UK 9", "quantity": 1 }],
  "termsAccepted": true,
  "termsVersion": "draft-2026-10"
}
```

- Only these fields are read. Prices, names, status, user and payment fields in the body are ignored.
- The server re-reads each product. It rejects missing, out-of-stock, non-`active`, non-GBP and unpriced products, and sizes not in the product's `sizes`. It snapshots the name, brand, image and retailer, and stores GBP amounts as integer pence (`unitPriceGBPMinor`, `lineTotalGBPMinor`, `pricing.subtotalGBPMinor`, `estimatedOnly: true`).
- Quantities are 1–10 per line, with at most 20 lines. Duplicate lines for the same variant are merged.
- Order numbers look like `EW-XXXXX-XXXXX`: 50 random bits in Crockford base32, with a unique index and a retry on collision.
- Responses:
  - `201 {orderId, orderNumber, status: "pending_contact", statusLabel, trackingHandoff: {accessToken, expiresInMinutes}, order}`.
  - A retry with the same key and body returns `200` with the same order.
  - The same key with a different body returns `409 IDEMPOTENCY_CONFLICT`.
  - `422 VALIDATION_FAILED | ITEMS_UNAVAILABLE` include per-field `fields`.
  - `400` for a missing key or invalid JSON; `429` when rate limited (20 per 15 minutes per client IP).
- Side effects are one `order_created` audit event and one `order_received` email in the outbox, deduplicated by `order_received:<orderId>`. If they fail after the order is saved, the order is kept and a retry repairs them.
- `GET /api/orders` needs login and returns `{items, pagination}` for the caller's own orders. Legacy `products` orders appear with `legacy: true`.
- `GET /api/orders/:id` returns the sanitized order to its linked customer or to a holder of a matching `X-Order-Access-Token`. Everyone else gets `404`.

### Order access tokens

These are HS256 JWTs signed with a key derived from `JWT_SECRET`, carrying audience `escowear:order-read` and the order id as subject. They are read-only and cover a single order. The customer auth middleware rejects any token with an audience, so an access token never works as a login. Tokens are never put in emails or URLs.

### Security fixes included

- The auth middleware now rejects tokens without a valid user id. Before, such a token could turn into an unfiltered `findOne`.
- Registration only accepts `name`, `email` and `password`.
- The JSON body limit is 32 KB, and malformed JSON returns a JSON error.
- `trust proxy` trusts loopback and private hops (`TRUST_PROXY`, default `loopback, linklocal, uniquelocal`). Behind Docker's port mapping the container sees the bridge address, so trusting only loopback would make every rate limit shared by all visitors.

## Guest checkout UI (IDE-115)

- `/cart` has a "Continue to checkout" link to `/checkout`.
- `/checkout` needs no login. It shows the "No payment now" notice and explains the GBP estimate versus the final GHS amount. It also offers an optional sign-in link, which returns you to checkout afterwards.
- The form collects:
  - Contact: name, email, Ghana phone.
  - Delivery: optional recipient name and phone, street address, area, landmark, town and region (16 regions).
  - Agreement to the order-request terms.
  Fields are checked in the browser first. Server field errors are mapped back to their inputs, and the first invalid input gets focus.
- Only `productId`, `size` and `quantity` are sent for each item; no prices.
- The `Idempotency-Key` is tied to a hash of the payload in `sessionStorage`. Retrying the same order after an error, a timeout or a reload reuses the key; changing the details creates a new key. The personal details themselves are never stored.
- The cart is cleared only after a `201` or `200` response with an order id. Server errors, network errors, `422`, `409` and `429` all keep the cart. Network errors tell the customer that retrying is safe.
- `/orders/:id/confirmation` shows "Order received — awaiting our email" and says the order is not paid and not confirmed. It lists the order number, the next steps, the items and the indicative GBP subtotal. It only loads with this tab's scoped access token (kept in `sessionStorage`) or the owner's login; otherwise it shows a privacy-safe "unavailable" state.
- The checkout consent text describes the order-request process only. Published terms and a privacy policy are still needed; see the decisions table.

## Admin manual payment and email workflow (IDE-116)

### Admin access

`users.role` is either `customer` (the default) or `admin`. Registration ignores `role`, and there is no API that grants it. An operator grants it on the server after the owner approves:

```bash
npm run admin:set-role -- --email staff@example.com --role admin --confirm
```

The script uses `updateOne`, so the password hash is never touched. The save hook also no longer re-hashes an unchanged password. Every `/api/admin/*` route reloads the user and checks `role === "admin"`. Anonymous users get `401`, and customers or unknown roles get `403`. Customer order-access tokens are rejected.

The UI lives at `/admin/orders`, with a paginated list filtered by status and searchable by order number, name or email, and `/admin/orders/:id`. The header shows an Admin link for admins, but the server enforces every rule regardless.

### State machine

Order status and payment status are tracked separately (`payment.status`: `not_requested → awaiting_payment → under_review → verified`, plus `rejected`, `refund_pending` and `refunded`).

| From | Allowed next |
|---|---|
| pending_contact | awaiting_customer, awaiting_payment, cancelled |
| awaiting_customer | awaiting_payment, cancelled |
| awaiting_payment | awaiting_payment (re-quote), awaiting_customer, payment_review, payment_issue, confirmed, cancelled |
| payment_review | payment_issue, confirmed, cancelled, refund_pending |
| payment_issue | awaiting_payment, payment_review, confirmed, cancelled, refund_pending |
| confirmed | processing, sourcing_failed, refund_pending |
| processing | dispatched, sourcing_failed, refund_pending |
| dispatched → delivered → completed | — |
| sourcing_failed | processing, refund_pending |
| refund_pending | refunded |

Every action sends `expectedStatus`. The update is an atomic compare-and-set on `status` (re-quotes also check `quoteVersion`). Stale or concurrent actions get `409 STALE_STATUS`, and moves not in the table get `409 ILLEGAL_TRANSITION`. Each change appends an `OrderEvent` recording the actor, the from/to status and sanitized details.

### Actions (`POST /api/admin/orders/:id/...`)

| Endpoint | Rules |
|---|---|
| `payment-instructions` | The admin enters items, fees, shipping and duties in GHS pesewas (integers) plus a future `expiresAt`. The server computes the total, bumps `quoteVersion` and queues the payment-instructions email (deduplicated per version). A re-quote must also send `expectedQuoteVersion`, otherwise it gets `409 STALE_QUOTE`, because re-quoting keeps the same status. Refused with `409 PAYMENT_CHANNEL_NOT_CONFIGURED` unless `ESCOWEAR_PAYMENT_INSTRUCTIONS` is set. |
| `awaiting-customer` | Requires a note. |
| `payment-review` | The customer's screenshot arrived by email. This only moves the order to review; nothing is uploaded or stored. |
| `verify-payment` | Requires `bankReceiptConfirmed: true`, `amountReceivedGHSMinor` equal to the quote total (otherwise `422 AMOUNT_MISMATCH`, so use payment-issue), `bankReference`, and a `receivedAt` that is not in the future. Records `verifiedBy` and `verifiedAt` and queues the confirmation email. This is the only way to reach `confirmed`. |
| `payment-issue` | Requires a customer message, which is emailed. The internal note is not emailed. |
| `fulfilment` | `toStatus` is processing, dispatched, delivered, completed or sourcing_failed. Requires verified payment. Accepts the supplier reference, carrier, tracking number and link. Sourcing failure needs a note. Processing, dispatched and delivered each email the customer once. |
| `cancel` | Requires a reason. Unpaid orders become `cancelled`; verified-paid orders become `refund_pending`. From `payment_review` or `payment_issue` the admin must send `refundRequired` (true or false), so money that arrived is never left unrefunded. No refund is made automatically. |
| `refund` | Records a refund that was sent manually. Requires `refundSentConfirmed`, a reference and an amount. |
| `notes` | Internal only, never shown to customers. |
| `events/:eventId/requeue-email` | Re-queues the email for an event if the queue was down. The dedupe key prevents duplicates. |
| `POST /api/admin/emails/:id/retry` | Re-queues a failed email. |

### Email outbox and delivery

- Messages are rendered when they are queued and stored in `emailoutboxes` with a unique `dedupeKey`.
- The worker claims each message atomically (`queued → sending`), passes `dedupeKey` to the transport as an idempotency key, and retries up to 5 times with exponential backoff (1 minute up to 1 hour). After that the message is marked `failed`, with `lastError` visible to admins.
- A message stuck in `sending` is marked `failed` and is not resent automatically, to avoid duplicates.
- Once sent, the bodies of payment-instruction and tracking-code emails are purged.
- `EMAIL_TRANSPORT=none` is the default; the worker does not run and mail stays queued. `log` exists for development only and is refused in production. A real provider adapter needs decision D3 and an approved dependency.
- Each worker tick also re-queues acknowledgements that were never queued.

## Order tracking and customer history (IDE-117)

### API

| Endpoint | Behaviour |
|---|---|
| `POST /api/orders/tracking/request` `{orderNumber, email}` | Always returns `202` with the same message, whether or not the order exists. The lookup runs after the response, so response time does not reveal it either. If the order number and email match, it creates a 6-digit code. Only an HMAC of the code is stored, in `trackingchallenges`, with a TTL. Any earlier unused code is superseded, and the code is queued in a `tracking_code` email. Malformed input returns `422`. Rate limits: 10 per 15 minutes per IP, 5 per hour per order number, plus a database cap of 5 codes per order per hour. |
| `POST /api/orders/tracking/verify` `{orderNumber, email, code}` | Each attempt is counted atomically before comparing (5 per code, with a timing-safe comparison). Too many attempts lock the code. A matching code is consumed atomically, so it cannot be replayed. Wrong, expired, reused and unknown codes all return the same `400 INVALID_CODE`. On success it returns `{orderId, accessToken, expiresInMinutes}`: a read-only token for that order only. Rate limit: 20 per 15 minutes per IP. |
| `GET /api/orders/:id` | Unchanged (IDE-114). Customers see the status label, a customer-visible history (status changes only), items, the GBP estimate, the GHS quote total and expiry, carrier, tracking number and link, and dispatch and delivery dates. Internal notes, bank and supplier references, payment-channel text, phone numbers and admin events are never serialized. |

- Tracking codes that are still queued after they expire are marked `failed` and their body is dropped, so an expired code is never delivered.
- Expired challenges are removed by a TTL index one day after expiry (`npm run db:ensure-order-indexes`).

### UI

- `/track-order` (also linked in the footer and in emails as `?order=EW-…`): enter the order number and email, then the code. On success the token goes into `sessionStorage` and the page opens `/orders/:id`.
- `/orders/:id` shows progress for the owner or a verified token holder. Without access it links to `/track-order` and sends no request. If there are no shipping details yet, it says so. Carrier links are shown only for http(s) URLs and open with `rel="noopener noreferrer"`.
- `/dashboard` now loads the signed-in customer's own orders (`GET /api/orders`), including legacy orders, and links to each new order.
- Status emails come from committed admin transitions (IDE-116): processing, dispatched (with carrier and tracking details), delivered, sourcing failed, cancelled, refund pending and refunded. Each is sent at most once per order and status.

### Not included

- Guest orders placed before an account existed are not linked to that account later. The spec requires verified email control first, which needs its own flow.
- There is no courier API integration.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ESCOWEAR_PUBLIC_URL` | empty | Site origin used for tracking links in emails |
| `ORDER_CHECKOUT_ACCESS_TTL_MINUTES` | 60 | Lifetime of the confirmation-page access token |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` setting |
| `REACT_APP_ORDER_TERMS_VERSION` (client build) | `draft-2026-10` | Terms version recorded on each order |
| `ESCOWEAR_PAYMENT_INSTRUCTIONS` | unset | **Private.** The payment-channel text inserted into payment-instruction emails (`\n` for new lines). Must never be committed. Quotes cannot be sent while it is unset. |
| `EMAIL_TRANSPORT` | `none` | `none` or `log` (development only) |
| `ORDER_TRACKING_CODE_TTL_MINUTES` | 10 | One-time code lifetime (provisional, D6) |
| `ORDER_TRACKING_CODE_MAX_ATTEMPTS` | 5 | Guesses per code |
| `ORDER_TRACKING_CODES_PER_HOUR` | 5 | Codes per order per hour |
| `ORDER_TRACKING_ACCESS_TTL_MINUTES` | 30 | Lifetime of the order access token after verification (provisional, D6) |

## Database changes

All changes are additive and optional, so legacy orders (`user`, `products`, `status: "Pending"`) stay valid. Production connects with `autoIndex: false`, so new indexes must be created on purpose:

```bash
npm run db:ensure-order-indexes   # additive createIndexes(); run only after a verified backup and approval
```

Indexes added:

- `orders`:
  - `unique_order_number` (partial)
  - `unique_order_idempotency_key` (partial)
  - `customer_email_created`
  - `user_created`
  - `status_created`
- `orderevents`: `order_created`
- `trackingchallenges`: `order_created`, `expire_challenges` (TTL)
- `emailoutboxes`:
  - `unique_email_dedupe_key`
  - `state_next_attempt`
  - `order_created`

Until the unique indexes exist, idempotency still works for sequential retries. Truly concurrent duplicates are only blocked once the unique index is in place.

## Real-MongoDB tests

`ESCOWEAR_TEST_MONGO_URI=mongodb://127.0.0.1:<port> npm run test:realdb` runs the suites against a disposable local MongoDB. Each run creates its own randomly named database and drops only that one. Non-local hosts and the production database name are refused. Without the variable, these tests are skipped.
