# IDE-129 — Manual Mobile Money checkout and fulfilment

Status: **implemented and tested locally on branch `feat/ide-129-momo-checkout` (based on PR #18). Not deployed, not launch-approved.**

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

Retention is **undecided**. `server/scripts/purgePaymentProofs.js` only reports unless retention is set **and** `--apply` is passed. It only touches finished orders and keeps the metadata.

## Production prerequisites (each needs separate owner approval)

1. **Nginx body limit.** `/etc/nginx/sites-enabled/escowear.com.conf` has no `client_max_body_size`, so Nginx's 1 MiB default applies.
   - The client shrinks images over about 900 KB, so typical screenshots already fit.
   - To honour the full 5 MiB, add `client_max_body_size 6m;` to that site and reload Nginx.
2. **Persistent volume.** The first `docker compose up` with the new `compose.yaml` creates the named volume `escowear_payment-proofs`. Add it to backups next to MongoDB.
3. **Indexes.** After a verified backup, run `npm run db:ensure-order-indexes` (additive). This adds the `PaymentProof` collection indexes.
4. **Private settings.** Set the real `ESCOWEAR_PAYMENT_INSTRUCTIONS`, a verified single support mailbox (`EMAIL_FROM`, and `EMAIL_REPLY_TO` if needed), `EMAIL_TRANSPORT=smtp` and `ESCOWEAR_PUBLIC_URL`.
5. **Launch gates still open from PR #18 and IDE-123:** credential rotation (exposed MongoDB/SMTP/JWT values), seller details, legal and policy approval, and support mailbox verification.

## Verification commands

```bash
npm run test:server
ESCOWEAR_TEST_MONGO_URI=mongodb://127.0.0.1:<port> npm run test:realdb   # disposable local mongod only
cd client && npm run lint && CI=true npm test -- --watchAll=false && npm run build
PLAYWRIGHT_CORE_PATH=<existing playwright-core> node e2e/browser-smoke.cjs
```
