# IDE-129 — Manual Mobile Money checkout and fulfilment

Status (28 Oct 2026): **merged (PRs #18, #19); launch prep on `fix/ide-129-launch-prep`. Not deployed. Checkout stays closed until the launch gates below pass.**

## Customer journey

1. **Order request.** Guest checkout creates an unpaid order request ("Order received — awaiting our email"). The response returns two short-lived, single-order tokens, both kept only in this tab's `sessionStorage`:
   - a read token (`escowear:order-read`), unchanged from before
   - a separate proof capability (`escowear:payment-proof`, scope `order:payment-proof:create`) that only allows uploading proof for that order
2. **Quote.** The admin enters the final GHS breakdown, the expiry (defaults to 48 hours) and, optionally, an estimated delivery date. The customer gets the payment-instructions email, which tells them to upload proof **on the website**.
3. **Pay and upload.** The order page shows the breakdown, the expiry and the Mobile Money instructions. The instructions come from `ESCOWEAR_PAYMENT_INSTRUCTIONS` and are returned only to the proven owner (`GET /api/orders/:id/payment-instructions`). The customer pays outside the site, then uploads a JPEG/PNG/WebP screenshot and the transaction ID (`POST /api/orders/:id/payment-proof`).
   - On success the order moves to `payment_review`, payment status `under_review`: "Payment submitted — under review. Your order is not confirmed yet."
   - A "payment proof received" email is sent.
4. **Returning later.** Guests use `/track-order` and the emailed one-time code. That returns a read token plus a new proof capability (default 60 minutes). A signed-in owner can upload without a capability.
5. **Admin review.** The order list flags "New proof to check". The order page shows the transaction ID, the expected total, the quote version and a warning if the reference was used on another order. The screenshot loads through an authenticated blob URL. The old "proof received" action remains only as a labelled fallback for proof sent by email.
6. **Verification.** `verify-payment` is unchanged. It still requires:
   - an attestation that the funds arrived in the receiving account
   - the amount, which must equal the quote total
   - the bank reference and the date received

   It marks the proof as accepted and sends the single "order confirmed" email.
7. **Payment problems.** `payment-issue` marks the proof as rejected, emails the customer and lets them upload a new proof. Cancelling from review or issue asks whether money was received, which sends the order to `refund_pending` and then `refunded`.
8. **Fulfilment.** The flow is `processing` (UK retailer reference) → `dispatched` (carrier and tracking) → `delivered` → `completed`.
   - New status `delivery_issue` covers lost, damaged or wrong-item cases. From there the admin can re-dispatch a replacement, mark delivered or completed, or cancel into refund.
   - New action `customer-update` sends a delay or news email and adds the message to the customer's history.
   - Fulfilment is re-checked against `payment.status = verified` inside the atomic update.
9. **Support mailbox.** Every customer email comes from the configured mailbox and ends "Questions? Just reply to this email." Replies go to `EMAIL_REPLY_TO`, or to `EMAIL_FROM` if that is unset. `npm run release:check` flags a reply-to address that differs from the sender.

## Upload security

| Control | Implementation |
|---|---|
| Ownership | Owner login or the proof capability, checked **before** the body is read. Anything else gets 404 (no probing). Read tokens cannot upload. |
| Size | Busboy streaming. `Content-Length` pre-check, then a hard cut-off at `ESCOWEAR_PROOF_MAX_BYTES` (default 5 MiB, ceiling 10 MiB). 413 if exceeded. |
| Type | Magic bytes must say JPEG/PNG/WebP and decode as the same format (sharp/libvips). Otherwise 415, or 422 if unreadable. The declared name and type are ignored. |
| Bombs | `limitInputPixels` of 40 MP. Returns 413. |
| Clean bytes | Images are re-encoded: EXIF/GPS and any appended payloads are dropped, and orientation is applied. |
| Storage | `ESCOWEAR_PROOF_UPLOAD_DIR` (Docker named volume `payment-proofs`). Random 128-bit names under `<orderId>/`, dir 0700, file 0600, atomic temp-then-rename. Never served statically. |
| Admin read | `GET /api/admin/orders/:id/payment-proof/:proofId`, admin only, order-bound. Headers: `no-store`, `nosniff`, sandbox CSP, CORP same-origin. |
| State | Requires an active, unexpired quote and the exact `quoteVersion`. Status must be `awaiting_payment` or `payment_issue`. Rechecked in the atomic order update. 409 if stale, 410 if expired. |
| Duplicates/races | `Idempotency-Key`: the same upload returns 200 with the same proof; a different upload with the same key gets 409. Concurrent uploads produce exactly one winner. Losers' files and records are removed. |
| Abuse | 15 uploads per IP per 15 minutes, 10 per order per hour, at most 4 in flight per process (otherwise 503). |
| Privacy | Customers see only the masked reference (`••••1234`). Events hold the masked reference only. Emails never include the image. |

## Configuration (names only)

`ESCOWEAR_PROOF_UPLOAD_DIR`, `ESCOWEAR_PROOF_MAX_BYTES`, `ESCOWEAR_PROOF_RETENTION_DAYS` (unset = keep), `ESCOWEAR_ADMIN_NOTIFY_EMAIL` (optional), `ORDER_PROOF_ACCESS_TTL_MINUTES`. Existing: `ESCOWEAR_PAYMENT_INSTRUCTIONS`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `ESCOWEAR_PUBLIC_URL`. See `.env.example`.

Payment instructions: set **either** `ESCOWEAR_PAYMENT_INSTRUCTIONS` **or** `MOMO_PAYMENT_NUMBER` + `MOMO_ACCOUNT_NAME` (optional `MOMO_NETWORK`, default "Mobile Money"). The MoMo settings are read at request time by the order and proof services. `release:check` names a half-set or doubly-set configuration without printing values. Run `release:check` inside the candidate container: on the host it reports `ESCOWEAR_PROOF_UPLOAD_DIR`, which only `compose.yaml` sets.

Retention is **undecided**. `server/scripts/purgePaymentProofs.js` only reports unless retention is set **and** `--apply` is passed. It only touches finished orders and keeps the metadata.

## Checkout switch

`ESCOWEAR_CHECKOUT_OPEN` (default `false`). While closed, the site, catalogue, admin and existing orders work, but new order requests get `503 CHECKOUT_CLOSED` and checkout shows "Online ordering opens soon" (cart kept). `GET /api/orders/checkout-status` returns only `{ open }`. The server **refuses to start** with `ESCOWEAR_CHECKOUT_OPEN=true` unless `npm run release:check` passes, so payment collection cannot open without real Mobile Money details (placeholder/test wording, `0XX` or `<slots>` are rejected), SMTP email, the HTTPS URL and published policies with complete seller details.

## Production state (28 Oct 2026)

| Prerequisite | State |
|---|---|
| Nginx `client_max_body_size 6m` on the EscoWear site | **Done**, `nginx -t` + reload, other sites checked |
| Pre-release backup | **Done**, encrypted, restore-tested in isolation (`/var/backups/escowear/IDE-129-20261028`) |
| Indexes (`db:ensure-order-indexes`) | **Done** on production after the backup; definitions verified against the models |
| Email | `EMAIL_TRANSPORT=smtp`, `ESCOWEAR_PUBLIC_URL=https://escowear.com` set (owner-approved); Gmail login and a test send passed; inbox receipt and reply still to be confirmed by the owner |
| Persistent volume `escowear_payment-proofs` | Created by the first deploy of this compose file; add to backups then |

## Launch gates still open

1. **Seller details:** done 30 Oct (owner-confirmed, in `client/src/policies/review.json`). Formal legal verification and registration are deferred.
2. **Support mailbox** `kofiarhin69@gmail.com`: owner confirms test-email receipt and a reply, then `emailVerified: true`.
3. **Mobile Money details** (`ESCOWEAR_PAYMENT_INSTRUCTIONS`): real network, number and account name, verified by the owner.
4. **IDE-123**: the MongoDB Atlas user leaked in public history (`863cca1`) is shared by nine Beast apps; rotate with a coordinated per-app plan. Current SMTP and JWT values are not in history.

## Verification commands

```bash
npm run test:server
ESCOWEAR_TEST_MONGO_URI=mongodb://127.0.0.1:<port> npm run test:realdb   # disposable local mongod only
cd client && npm run lint && CI=true npm test -- --watchAll=false && npm run build
PLAYWRIGHT_CORE_PATH=<existing playwright-core> node e2e/browser-smoke.cjs
```
