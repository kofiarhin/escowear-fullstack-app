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

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ESCOWEAR_PUBLIC_URL` | empty | Site origin used for tracking links in emails |
| `ORDER_CHECKOUT_ACCESS_TTL_MINUTES` | 60 | Lifetime of the confirmation-page access token |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` setting |
| `REACT_APP_ORDER_TERMS_VERSION` (client build) | `draft-2026-10` | Terms version recorded on each order |

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
- `emailoutboxes`:
  - `unique_email_dedupe_key`
  - `state_next_attempt`
  - `order_created`

Until the unique indexes exist, idempotency still works for sequential retries. Truly concurrent duplicates are only blocked once the unique index is in place.

## Real-MongoDB tests

`ESCOWEAR_TEST_MONGO_URI=mongodb://127.0.0.1:<port> npm run test:realdb` runs the suites against a disposable local MongoDB. Each run creates its own randomly named database and drops only that one. Non-local hosts and the production database name are refused. Without the variable, these tests are skipped.
