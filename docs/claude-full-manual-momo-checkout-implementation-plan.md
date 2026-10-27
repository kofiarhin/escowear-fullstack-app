# EscoWear — Complete Manual Mobile Money Checkout & Fulfilment Implementation Contract

**Status:** Full end-to-end engineering handoff for Claude Code on Beast. **Not implemented by this document.**  
**Date:** 27 October 2026  
**Repository:** `kofiarhin/escowear-fullstack-app`  
**Execution intent:** Build the **whole cohesive customer-to-delivery experience in one implementation effort**, not a sequence of narrow feature slices. Shipping the working feature is the priority. Tests and essential security are part of shipping, not optional phases.

## 0. Claude's mission

Implement, integrate and verify the **entire manual Mobile Money flow**: browse → guest order request → admin-issued final GHS quote → customer sees payment instructions on website and by email → customer pays Mobile Money externally → customer uploads screenshot + transaction reference **on website** → admin reviews proof **and independently checks funds arrived** → admin confirms payment → one official support email sends confirmation/status communications → admin manually buys UK shoes → dispatch/tracking → delivery/completion, with payment issues, sourcing failures, cancellations and refunds supported by the existing workflow.

This is **not** a proposal to add automated payment gateway, supplier API, courier API, auto-priced GBP/GHS quotes, or a new authentication system. Preserve the existing admin-issued quote: product GBP subtotal is indicative until admin reviews supply and creates the final GHS quote. Do **not** display an unapproved final price at initial checkout. Never say payment is confirmed merely because a screenshot was uploaded. Only verified incoming funds unlock sourcing.

The user wants a complete implementation in one Claude run. Claude may order its own tasks for safe execution, but must not stop after a partial subset and call it finished. If an external dependency blocks a requirement, report an explicit blocker and truthful incomplete state.

## 1. Repository evidence and compatibility

Read current repo and deploy branch *before coding*. The inspected **master** contains:
- `client/src/Pages/Checkout/Checkout.page.js`: guest checkout creates an **order request**; says “No payment now”; posts `POST /api/orders` with idempotency key.
- `client/src/Pages/OrderConfirmation/OrderConfirmation.page.js`: receipt says awaiting GHS quote, and currently says email screenshot.
- `client/src/Pages/OrderDetails/OrderDetails.page.js`: customer/guest-scoped tracking view; displays quote expiry; does **not** offer upload or website payment instructions.
- `client/src/Pages/AdminOrderDetail/AdminOrderDetail.page.js`: admin actions `payment-instructions`, `payment-review` (manually acknowledges emailed proof), `verify-payment`, `payment-issue`, `fulfilment`, `cancel`, `refund`.
- `server/routes/ordersRoute.js`, `server/controllers/ordersController.js`, `server/services/orderService.js`: guest orders, scoped reads and emailed tracking-code access.
- `server/routes/adminRoute.js`, `server/controllers/adminOrdersController.js`, `server/services/orderWorkflow.js`: admin-only state machine, atomic expected-status/quote-version checks and email outbox.
- `server/Models/Order.model.js`: finalGHS quote; payment status/reference, amount and verifier fields; fulfilment; optional legacy records.
- `server/services/orderAccess.js`: **existing tokens are read-only** (`scope: order:read`, audience `escowear:order-read`); never use them to authorize proof uploads.
- `server/services/orderStatus.js`: `pending_contact`, `awaiting_payment`, `payment_review`, `payment_issue`, `confirmed`, `processing`, `dispatched`, `delivered`, `completed`, etc; separate payment states.
- `server/emails/templates.js`, `server/services/emailOutbox.js`, `server/services/emailWorker.js`, `docs/email-setup.md`: SMTP mail and durable deduplicated notifications.
- `server/config/orders.js`: expiry of checkout/tracking tokens, public URL.
- Tests: `server/tests/{guestOrders,adminWorkflow,orderTracking,e2eCheckout,realDb.orders,realDb.admin}.test.js`; `client/src/Pages/{Checkout,OrderConfirmation,AdminOrderDetail,TrackOrder}/*test*`; `e2e/`.
- Existing docs: `docs/manual-checkout-implementation.md`, `docs/release-readiness-manual-checkout.md`, `docs/manual-momo-payment-order-flow.md` on separate branch `docs/escowear-momo-proof-upload-20261027`.
- Open **PR #18**, `prep/escowear-mvp-launch`, targets `master` and contains policy-hidden launch preparation, email/policy configuration and tests. **Not merged** when last inspected. Inspect and reconcile changes before work; never silently overwrite.
- **Do not mix payment work with exposed credential remediation** without separate explicit approval. Linear IDE-123 unresolved. User chose to defer credential rotation until project completion; this remains a **hard launch-risk disclosure**, not a claim of safety.

Always inspect actual Beast workspace branch, dirty files, AGENTS/CLAUDE instructions, installed dependencies, live configuration *names only*, Docker/storage volumes and tests. GitHub docs may lag the workspace. Never echo or commit `.env`, app passwords, database URIs, JWT secrets, images with customer data, or payment account details.

## 2. Customer-facing contract

**A. Guest order request:** shopper selects product/size/quantity; fills name, email, Ghana telephone and delivery address; sees clearly indicative GBP information; agrees to approved/available terms; submits once. Server creates stable order number and replies “Order received — awaiting final GHS quote”, not paid/confirmed. Preserve safe retry/idempotency and guest access.

**B. Admin quote:** after checking current UK item/size availability and shipping/customs estimates, admin enters final GHS breakdown (shoe subtotal, fees, shipping, duties, full total) and quote expiry in existing dashboard. Customer receives email from EscoWear support inbox and sees price, line-item breakdown, expiry, estimated delivery date if set, order number, and MoMo payment instructions on a **private order page**. Customer pays standard delivery; customs included in agreed total; never request extra payment after an agreed paid quote. Expired quotes block new proof submissions and payment instructions prompt customer to request a refreshed quote. Do not assume “15 minutes”; current PR #18 mentions 48-hour default. Retain configurable admin quote expiry rather than invent owner approval of specific validity.

**C. Payment:** payment takes place externally (MoMo/USSD) to configured account. Customer enters transaction reference and uploads a readable screenshot (mobile camera/gallery and desktop file picker), then taps “Submit payment proof”. User sees an upload-progress/submit state, on success **“Payment submitted — under review. Your order is not confirmed.”** Customer can view submitted timestamp/reference (masked where appropriate), not private server storage path. Refresh/re-login or guest tracking flow should preserve review state. Show accessible error/retry for network failures; never fabricate successful upload.

**D. Admin review:** admin dashboard indicates new proof submitted, links to protected image and displays the reference, expected total, quote version, submission time. Admin checks the **real receiving Mobile Money account transaction history** independently for amount, recipient, transaction reference and date. Screenshot alone is never adequate. On success admin uses existing explicit `verify-payment` action (received amount must equal quote; `bankReceiptConfirmed: true`; bank reference/time; actor/time audited), sends order confirmation email and unlocks fulfilment. On missing/mismatched/duplicate payment, use `payment-issue`, tell customer what to do, keep fulfilment disabled; allow controlled resubmission.

**E. Fulfilment & support:** admin buys exact size from approved UK retailer *after* verified funds, records sourcing reference, manages dispatch/courier tracking, flags delays, marks delivered and completed. Customer views current status and verified events and receives from/replies to the same configured support inbox. If stock unavailable, offer customer explicit alternative or full refund. If wrong shoes, free replacement and EscoWear pays return freight; damaged shoes, customer chooses free replacement or full refund, EscoWear pays return freight. Preserve cancellation/refund transitions. Lost parcels require recorded investigation and customer resolution; no automatic decision without policy.

**Two distinct confirmations:** after placement **order received** (unpaid); after receiving uploaded screenshot **proof received** (unverified); only after actual MoMo receipt **payment verified / order confirmed**. Avoid duplicate “order confirmed” email or misleading status anywhere.

## 3. Design for secure upload and guest ownership (mandatory)

The current guest token is **read-only**; it cannot authorize posting a receipt. Build a separate, narrowly scoped proof-submission capability:

- Preferred: after successful order lookup through existing email one-time tracking code, issue a **short-lived order-bound `order:payment-proof:create` capability** with a **distinct audience and purpose**, independently validated only on upload; optionally return a corresponding scoped submit token immediately after first order placement. Never broaden `escowear:order-read` tokens. Never put tokens in URL query strings or emails; store in session memory/sessionStorage only and clear on expiry. Authenticated users may submit only for orders they own, with the same server-side status/quote checks.
- Integrate into existing `/track-order` email verification handoff in a backward-compatible way; mint the write capability only after actual proof of order ownership. Ensure old read token stays read-only and cannot upload by itself. No IDOR, token replay for a different order, or cross-account submits.
- Endpoint proposed: `POST /api/orders/:id/payment-proof` with `multipart/form-data` fields `transactionReference`, `quoteVersion`, `proofImage`; supporting `Idempotency-Key` or equivalent atomic duplicate guard. Require active final quote, exact quote version, allowed status `awaiting_payment` (or explicitly controlled retry from `payment_issue`), verified order-scoped capability/owner, sensible rate limit, explicit maximum upload/body byte sizes, HTTP 409 for stale states/quote, HTTP 410 for expired quote, HTTP 413 large image, HTTP 415 unsupported image, appropriate 401/403/404 without leaking order existence.
- Accept only **JPEG/PNG/WebP** if image verification supports them. Default single file, max **5 MiB** (configurable with a safe upper bound); validate actual magic bytes + decoded file content (not filename/content-type alone). Reject SVG, HTML, PDF, executable/polyglot content and decompression bombs; strip EXIF and transcode/re-encode to safe image bytes where practical. Prefer an existing safe dependency if available; otherwise select and document narrowly scoped new dependency; no remote image fetch. Validate reference (trim, non-empty, bounded length, safe character set); store no client-provided payment amount as authoritative. Enforce per-IP/per-order throttle and total storage quotas.
- **Private durable storage** outside web/static roots and public Docker bind mounts, mounted to a persistent server volume on Beast, with unique non-guessable filenames/keys. Restrict filesystem permissions; never serve files via Express static; expose only a guarded admin endpoint `GET /api/admin/orders/:id/payment-proof/:proofId` (or equivalent) with revalidated admin role + scoped order/proof association, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, restrictive CSP/content disposition. Admin view fetch should use authorized request/blob URL and revoke URL on unmount. Prevent URL/log leakage. Retention and deletion policy is still an owner/legal open decision; implement documented configurable purge/backup-compatible lifecycle but **do not silently delete existing data**, and mark retention policy pending confirmation.
- Avoid “DB points at nonexistent file”: stage image safely and coordinate metadata/transition; on failures clean orphan uploads and maintain accurate payment status. Metadata stored in order or dedicated `PaymentProof` model with `orderId`, `quoteVersion`, `reference`, `storageKey`, `contentType`, `sizeBytes`, `sha256`, `createdAt`, `submitter`, `reviewStatus`; avoid exposing `storageKey` to customer. Add DB indexes only if necessary and with backup/approval before production index operations.
- Protect against duplicates and races. Exactly one active proof for active quote; idempotent retry of same upload should return same proof, conflicting upload gets 409 unless explicit resubmission is authorized after issue. Race with admin re-quote/cancel/verify should fail safely. Prevent reusing same transaction reference across separate orders where feasible, but allow legitimate investigation without losing evidence.
- Critical: **proof submission transitions to `payment_review` and `payment.status=under_review`, never to `verified`**. Record sanitized audit event with proof channel `website_upload`. Admin verification must still use the existing real-funds attestation and exact quote total. Disable sourcing if payment unverified even if status tampered with.
- Abuse prevention: no arbitrary uploads to public site, malware-risk file serving, unbounded files, leaking personal receipts in mail/outbox, or verbose secrets in logs. Test after deployment against configured reverse proxy body limits without changing Nginx unapproved.

## 4. API, model and UI contract

### API

Retain existing endpoints. Add as needed:
1. `POST /api/orders/:id/payment-proof` — secure upload; response `201 {proofId, submittedAt, status:"under_review", orderStatus:"payment_review"}`; idempotent same-request retry `200`; server verifies ownership, current quote and status before and while committing.
2. `GET /api/admin/orders/:id/payment-proof/:proofId` — protected image bytes; never publicly cache.
3. Tracking/checkout token handoff endpoint or adapted successful code verification response to return separate guest upload capability. Never replace the read-only token in customer GET responses with a general write token.
4. If supporting website display of payment instructions, add order-scoped access `GET /api/orders/:id/payment-instructions`, guarded as strictly as payment-proof upload. Return a sanitized display object (recipient label/account number from configured private env, quote version, total, expiry). **Do not include configured instructions in public catalogue/order emails unnecessarily.** Preserve existing email instructions.
5. Consider `GET /api/orders/:id/payment-proof/status` only if customer order read serializer cannot safely convey review state. Return a minimal public summary; never binary content or full payment references.

Do not duplicate a route that exists on the Beast branch; inspect and adapt.

### DB

Keep backward compatibility for legacy orders and old guests. Extend `Order.payment` conservatively or add a referenced `PaymentProof` model to avoid storing binary data in MongoDB and to support resubmission history. Keep immutable quote snapshots/versions. Record `proofId`, `reviewStatus`, `submittedAt`, `quoteVersion`, `transactionReference`; guard exposure in `toCustomerOrder`/admin serializers and `OrderEvent`. Do **not** put raw proof image or secret MoMo instructions into database logs/events.

### Customer UI

- `Checkout.page.js`: preserve “order request; no payment yet” explanation and Ghana contact/address validation.
- `OrderConfirmation.page.js`: explain customer must await final GHS quote, then pay and upload proof **on the website** (not email screenshot).
- `OrderDetails.page.js`: when awaiting payment with active quote, display GHS breakdown, expiry, server-provided MoMo instructions, reference, secure upload field and accessible button. After upload show “Under review”, no submit except controlled resubmission; after verification show “Confirmed”. For expired quote show “Request updated quote” / contact support, never solicit payment at old price.
- `TrackOrder.page.js` plus `client/src/utils/orderAccess.js`: secure guest re-entry, short-lived dedicated proof capability; do not break existing read-only order viewing.
- Mobile-first layout; clear upload validation, real server errors, keyboard/screen-reader labels, visible loading, privacy-safe fallback, no client-side authoritative price/payment status.
- `AdminOrderDetail.page.js`: proof metadata/image viewer with secure fetch, amount/reference comparison and real bank receipt confirmation. Old “proof received by email” manual action can remain as explicitly labeled fallback, but new website uploads must auto-mark under review. Avoid requiring admin to click two proof-received actions.
- Show estimated delivery only if grounded in configured operational data; where unknown say “estimate will be confirmed”, never invent a date.

### Email/support

Retain `EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `ESCOWEAR_PUBLIC_URL`. One owner-designated mailbox sends all transactional mail and receives customer replies and support; if SMTP username differs, provider must support verified From alias. Do not hardcode an unverified `support@escowear.com`.

Change `server/emails/templates.js` to instruct order-specific website upload rather than “reply with screenshot”, and remind users payment is not confirmed until admin verifies actual funds. Keep payment instructions, receipt, payment issue, order confirmed, sourcing, dispatch, delivery and refund messages deduplicated and mail worker failures recoverable. Link to order tracking URL without embedding access tokens. Send admin operational notification of proof submission through existing dashboard/queue only if safe and configurable; do not expose payment screenshot by email.

## 5. Configuration, deployment and security boundaries

Existing essential variable: `ESCOWEAR_PAYMENT_INSTRUCTIONS` privately contains human-readable MoMo recipient/payment instructions. Avoid adding redundant `ESCOWEAR_MOMO_NUMBER` and `ESCOWEAR_MOMO_ACCOUNT_NAME` unless implementing a backward-compatible structured alternative. Add only needed non-secret defaults such as `ESCOWEAR_PROOF_UPLOAD_DIR`, `ESCOWEAR_PROOF_MAX_BYTES`, optional `ESCOWEAR_PROOF_RETENTION_DAYS` (do not turn on destructive pruning without policy approval). Document each in `.env.example` or `docs/` **without copying real values**.

**No secrets in Git.** The existing `.env` screenshot exposed database credentials, app password and JWT key. Treat them as compromised. Do not print them during inspection or put them in Claude prompts. Existing shared MongoDB rotation remains owner-deferred; **must be resolved before production customer-data checkout** even if implementation is code-complete. Maintain distinction between code-ready and launch-approved.

Beast runtime: identify exact registered workspace and active Git state, project compose/service names and persistent volumes before modification. Do not assume repo `master` matches running environment. Changes to production service, persistent volume mount, filesystem ownership, Nginx body limit, DNS, ports, secrets, indexes or deployment **require separate explicit owner approval**. Never claim localhost test is live runtime verification. Docker volume must survive container recreation; files must not be under `client/public`, `server/images` or ephemeral container filesystem.

## 6. Full implementation execution sequence (one end-to-end delivery, not separate releases)

1. **Baseline:** verify workspace, `git status`, branch, existing instructions and all relevant docs; inspect PR #18 vs master, dedicated flow doc branch, current route mounting, upload middleware support, Docker Compose and deployment. Identify and preserve dirty work. Confirm no live production mutation.
2. **Contract/tests first:** express acceptance journey as runnable integration/E2E tests with deterministic fake MoMo verification and private temp upload store. Add fixtures for valid/corrupt/oversize files, expired/stale quotes, authorization and races.
3. **Data and upload foundation:** implement safe proof storage adapter, streaming/size-checked multipart processing, image verification/re-encode, metadata and atomic guards. Add API/controller/service with testability/injection and rollback/orphan cleanup. Keep legacy orders compatible.
4. **Guest submission authorization:** separate proof-write token issued only through existing ownership checks; handle guest checkout first-page and subsequent tracking-code recovery; implement rate limiting, expiry and invalidation scenarios.
5. **Order/payment workflow:** automatically transition upload to under review with events, preserve admin attestation, fix concurrent re-quote conflicts, enable controlled resubmission and explicit issue state. Keep fulfilment gated behind real-funds verification.
6. **Customer experience:** order details and confirmation pages, privacy-safe instructions, screenshot picker, transaction ID, feedback, errors, paid/unpaid statuses, responsive UI, track-order recovery.
7. **Admin experience:** protected proof viewer, metadata, required independent funds confirmation, payment issue/resubmission flow and review queue discoverability. Reuse existing workflow rather than parallel payment state machine.
8. **Emails/support:** consolidate sender/reply-to, order confirmation and order update copy, website upload link; preserve queue dedupe and retry behaviour.
9. **Quality and release readiness:** update test files and docs, run server/unit, client, real disposable MongoDB, importer where relevant, build, lint, browser/E2E on desktop/mobile, auth/privacy/security checks and Docker image/config checks in safe local environment. Reconcile PR #18 conflicts and document them. Ensure no simulated success for external deliveries.
10. **Handback:** provide change inventory, implementation evidence, tests with counts/commands, PR/branch/commit SHA if actually made and authorized, known defects, explicit launch blockers, rollback/backup notes and Next Action; update Linear implementation issue with exact state. **No merge or deployment without separate approval**.

Claude should fix discovered defects within approved feature scope, not stop at first passing unit test. Do not mark complete if any mandatory acceptance case is untested or failing; state what is missing. If requirements conflict with material scope or risk, stop before that specific consequential operation and ask for approval; continue non-consequential local verification where possible.

## 7. Mandatory acceptance criteria

- **AC01:** Guest can place order request with safe retries; unverified request cannot start fulfilment.
- **AC02:** Admin can issue final GHS quote with breakdown, expiry and MoMo details from private config; customer can read quote and payment instructions only for own order; no false initial final price.
- **AC03:** Mobile/web customer can upload real JPEG/PNG/WebP screenshot + reference for correct active quote; success survives reload; status reads **under review**.
- **AC04:** Read-only scoped order token or another person's identity cannot upload; tracking-code-proven owner gets only order-specific short-lived proof-submit capability.
- **AC05:** Invalid/empty/corrupt/oversize/unsafe images, expired quotes and stale versions rejected with clear responses; no orphan or public files.
- **AC06:** Concurrent uploads, repeated submit, stale admin quote and cancellation are idempotent or safely rejected; exactly one active proof and appropriate audit trail; no duplicate email.
- **AC07:** Admin sees new proof without manual email-received step; receives only protected image; unauthorized customers cannot fetch screenshot.
- **AC08:** Screenshot does not verify payment; only existing admin action with actual account receipt attestation, reference, amount equal quote and date can set verified/confirmed.
- **AC09:** Supplier purchase and shipment transitions blocked before verified payment, allowed after it; no duplicate purchase transition.
- **AC10:** Payment mismatch, missing funds, customer resubmission, cancellation/refund and unavailable shoes are handled with clear status and messages.
- **AC11:** Separate order receipt, proof-received state and payment-confirmed email; all customer mail uses configured sender/reply-to and safe tracking URL; email outage does not lose order/proof state.
- **AC12:** Responsive and accessible phone/desktop flow (screens, keyboard, mobile camera input); console/network errors investigated.
- **AC13:** Existing guest order, tracking-code, admin, legacy and email tests stay passing; new tests cover upload security, race conditions, integration and E2E.
- **AC14:** Private receipt storage survives application restart in local/container test; temp failures clean up; no secrets or uploaded images in Git/logs/client bundles.
- **AC15:** Document full deployment prerequisites and unresolved legal/security gates; do not enable live checkout or claim production readiness solely from code tests.

## 8. Verification commands (adapt to live repo)

```bash
git status --short
npm run test:server
npm run test:realdb  # ONLY with safely isolated disposable loopback MongoDB per docs
CI=true npm test --prefix client -- --watchAll=false
npm run build --prefix client
npm run test:e2e    # requires configured local Playwright/Chromium harness
npm run test:importer
```

Use real project scripts/CI from checked-out ref; document skipped/unavailable checks rather than claiming pass. Test real DB only against dedicated local throwaway DB, NEVER production. For upload E2E, cover guest tracking-code recovery, duplicate screenshot submit, invalid file, admin verification gate and UI on mobile. Validate fresh build, SMTP template rendering and no paid-order confirmation before actual receipt.

## 9. Scope and release decisions

### Locked functional decisions

Manual Mobile Money; website screenshot + transaction ID; independent admin checking of actual received funds; admin starts UK purchasing only after verified payment; single support mailbox for transactional and customer support; Ghana-first made-to-order; customer delivery costs disclosed, customs included, checkout total honoured; wrong/damaged protections recorded in IDE-126.

### Not locked / don't invent

Actual MoMo account details; verified single support email/address; legal business registration/name; courier/coverage; quote lifetime; automated GBP→GHS pricing; final delivery estimate formula; specific retention period; production image storage path; lawful policies and Ghana legal review.

### Explicit out of scope unless newly approved

Automated Paystack/webhooks, automated supplier checkout, courier APIs, replacing login, fully automatic pricing, production deployment, merging PR #18, production secret changes, DNS/Nginx/firewall, service restarts, database destructive migration, public launch.

## 10. Delivery format Claude must return

1. **Implemented:** file changes and user-visible behaviour, links or exact refs.
2. **Verified:** actual commands/results, E2E story, pass/fail/skips, safe environment.
3. **State:** implemented / tested / committed / pushed / PR / merged / deployed / runtime verified **separately**.
4. **Blockers:** config, owners, legal and credential exposure.
5. **Next Action:** one concrete step with any required owner approval.

**Do not stop after a thin slice. Implement the whole approved feature set locally. Production launch is a separate approval gate.**
