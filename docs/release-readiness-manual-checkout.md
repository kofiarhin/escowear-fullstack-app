# Release readiness — manual checkout (IDE-114 to IDE-118)

> Historical verification report (21 October). For current merged-code evidence,
> owner decisions, backup status and launch gates, use [mvp-launch-checklist.md](mvp-launch-checklist.md).

**Date:** 21 October 2026
**Status:** Verified locally in isolation, including against a real MongoDB 7.0 server. Reviewed and fixed on 21 October 2026. **Not released.** Production is blocked by the items below.
**Branches** (stacked; each builds on the previous one, starting from `master@a7c650c`):

| Ticket | Branch | Commit |
|---|---|---|
| IDE-114 Guest order API | `feat/ide-114-guest-order-api` | `45bf14f` |
| IDE-115 Guest checkout | `feat/ide-115-guest-checkout` | `363d8b9` |
| IDE-116 Admin manual payment and email | `feat/ide-116-admin-manual-payment` | `78f06d7` |
| IDE-117 Order tracking | `feat/ide-117-order-tracking` | `3072d77` |
| IDE-118 End-to-end and release readiness | `feat/ide-118-e2e-release-readiness` | see `git log` |

Nothing has been pushed, merged or deployed. No production database, secret, service, Nginx or DNS was touched.

## Evidence (run 21 October 2026 on Beast, Node 22.23.2)

| Check | Command | Result |
|---|---|---|
| Server unit/API tests (in-memory models) | `npm run test:server` | **55/55 pass** |
| Real MongoDB 7.0.14 suite | `npm run test:realdb` | **21/21 pass** |
| Importer tests | `npm run test:importer` | **3/3 pass** |
| Client tests | `CI=true npm test --prefix client -- --watchAll=false` | **50/50 pass**, 9 suites, no act() warnings |
| Client production build | `npm run build --prefix client` with `CI=false`, as the Dockerfile does | **Compiles.** 3 warnings, all pre-existing in untouched files (Register, Logout, user reducer). `CI=true` builds fail on these pre-existing warnings, on `master` too. |
| Full API journey | `server/tests/e2eCheckout.test.js` | **Pass.** Cart → order with double submit → acknowledgement during a provider outage, then retry → GHS quote → proof → bank verification → dispatch → code tracking → completed, with no duplicate emails. |
| Browser smoke, headless Chromium, desktop 1280×860 and mobile 390×844 | `PLAYWRIGHT_CORE_PATH=… npm run test:e2e` | **18/18 pass in memory and 18/18 on real MongoDB** |
| Auth/orders container smoke (updated to the new contract) | `deploy/beast/auth-orders-smoke.cjs` (run locally with paths rewritten) | **5/5 PASS** |

The browser smoke runs against `e2e/harness.cjs`: the real Express app and the production React build, with in-memory models, a capturing mail transport, and fake people and payment-channel text. It covers:

- Product → size → cart → checkout.
- Client validation and focus on an empty submit.
- Order submitted by keyboard; received-only receipt; cart cleared.
- The confirmation URL opened in a fresh browser reveals nothing.
- Admin: GHS quote → proof under review → mismatched bank amount refused → verified → processing → dispatched with carrier.
- Guest: wrong code refused → emailed code → order view with tracking and no internal data.
- Each email sent exactly once.
- Every page: one `h1`, every control labelled, no horizontal overflow at 390 px.
- No console errors, page errors, failed requests or 5xx responses. The only 4xx responses are the two deliberate negative steps.

`playwright-core` is **not** a project dependency. The run used an existing install (`/home/ubuntu/projects/banging-prices/node_modules/playwright-core` 1.58.2) and the cached Chromium 1208.

### Acceptance criteria (isolated environment)

| AC | Result | Evidence |
|---|---|---|
| AC01–02 size, quantity, cart merge and persistence | Pass (IDE-113, plus server-side re-validation) | cart tests; `guestOrders.test.js` |
| AC03 guest checkout, GBP vs GHS messaging | Pass | `Checkout.page.test.js`; browser smoke |
| AC04 contact, address and terms validation | Pass | `Checkout.page.test.js`; `guestOrders.test.js` |
| AC05 tampering rejected, server snapshots | Pass | `guestOrders.test.js` |
| AC06 idempotent submit, one acknowledgement | Pass | `guestOrders.test.js`; `e2eCheckout.test.js` |
| AC07 cart kept on failure, cleared on success | Pass | `Checkout.page.test.js`; browser smoke |
| AC08 admin RBAC, no self-assigned admin role | Pass | `adminWorkflow.test.js` |
| AC09 GHS quote, configured channel, no gateway or upload | Pass | `adminWorkflow.test.js`; browser smoke |
| AC10 screenshot alone cannot verify | Pass | `adminWorkflow.test.js`; browser smoke |
| AC11 illegal or concurrent transitions rejected, audit trail | Pass | `adminWorkflow.test.js` |
| AC12 one-time-code tracking scoped, no expired/reused/enumerated codes | Pass | `orderTracking.test.js`; browser smoke |
| AC13 customers see only their own orders | Pass | `guestOrders.test.js`; `orderTracking.test.js`; `Dashboard.page.test.js` |
| AC14 shipping status and tracking visible, internal data hidden | Pass | `orderTracking.test.js`; browser smoke |
| AC15 email outage keeps orders, retries visible | Pass | `adminWorkflow.test.js`; `e2eCheckout.test.js` |
| AC16 legacy orders readable, no destructive migration | Pass in code; **production data not assessed** | `guestOrders.test.js` |
| AC17 mobile/desktop, states, accessibility, console | Pass (automated checks only; no screen-reader or manual audit) | browser smoke |

## Review round 2 (21 October 2026): bugs found and fixed

| PR | Issue | Fix | Proof |
|---|---|---|---|
| #11 | Behind Docker's port mapping the container sees the bridge IP, but `trust proxy` trusted only loopback, so **every rate limit was shared by all visitors** | Trust loopback and private hops (`TRUST_PROXY`) | unit test of the trust function; per-client limit test |
| #11 | Concurrent idempotent retries wrote **duplicate `order_created` events** | unique `dedupeKey` on events | reproduced 3/3 on real MongoDB before the fix; 10-way concurrency test passes after |
| #11 | Login passed request values straight into the query (`{"$gt": ""}`) | strings only, normalized email | real-DB test |
| #12 | An expired stored login made checkout fail with a generic error, and the confirmation page show "unavailable" | sign out on 401 and let the customer resubmit as a guest; prefer the scoped token | client tests |
| #13 | A **duplicate re-quote click sent two quotes and two payment emails** (the status does not change on a re-quote) | `expectedQuoteVersion` is required (`409 STALE_QUOTE`) | reproduced on real MongoDB; 5-way concurrency test passes after |
| #13 | Cancelling from `payment_issue` (for example a short payment) could leave **received money with no refund tracked** | explicit `refundRequired` decision; `true` leads to `refund_pending`. The refund amount is stored on the order | memory, real-DB and UI tests |
| #13 | Login said "user not found" vs "wrong password", revealing which accounts (including admins) exist | one generic error | real-DB test |
| #14 | Tracking-code request timing revealed whether an order and email pair existed | 202 is returned before the lookup runs | tests |
| #14 | Stale login blocked `/orders/:id`; the dashboard showed an error on 401 | prefer the scoped token; sign out on 401 | client tests |

## Real-MongoDB evidence

The suites ran against a throwaway local `mongod` 7.0.14, an existing cached binary started on `127.0.0.1` with its data in a temporary directory. Nothing was installed and no container was started. Command: `ESCOWEAR_TEST_MONGO_URI=mongodb://127.0.0.1:<port> npm run test:realdb`. Each suite uses its own randomly named database, then drops it. Afterwards the server held only `admin`, `config` and `local`.

- **21/21 real-DB tests pass.** They cover:
  - Index creation through the same additive path as `ensureOrderIndexes`.
  - 10 concurrent submits with one key giving one order, one event and one email.
  - Partial unique indexes accepting legacy documents.
  - Legacy documents in the old shape read correctly.
  - Append-only events.
  - Stored-role checks.
  - The full admin flow with `select:false` fields.
  - Concurrent quotes, re-quotes and verify/issue races.
  - Three concurrent email workers sending each email once.
  - Tracking-code TTL, single use, 20 parallel guesses and 10 parallel correct verifies.
  - Login operator injection and account enumeration.
- **Browser smoke against real MongoDB: 18/18 pass** (`ESCOWEAR_TEST_MONGO_URI=… npm run test:e2e`).

## Test limitations

- The default `npm run test:server` uses an in-memory stand-in. The real-DB suite is opt-in and must be run by hand (no CI is configured). It ran against MongoDB 7.0.14; the production server version was not checked (it is read-only information to collect before release).
- Rate limits are per process and in memory, which suits the single-container deployment but resets on restart.

## Security review

- **Secret in git history (action needed by the owner).** `.env` containing a MongoDB Atlas connection string *with credentials* (`MONGO_REMOTE`, cluster `cluster0.lj8un…`) was committed in `863cca1` (June 2022) and removed in `7a2813c` (October 2026). It is still in the repository history on GitHub. If that database user still exists, **rotate the credential**. Rewriting history is a separate destructive decision. No other private keys, AWS keys, Stripe keys or JWT secrets matched the scan, and no `.env` file is tracked now.
- **Dependency audit** (`npm audit --omit=dev`, read-only), all pre-existing and not introduced by this work:
  - Root: 20 vulnerabilities (3 critical, 9 high). They are in `mongoose` 6, `express` 4.18, `jsonwebtoken` 8 and their transitive dependencies.
  - Client: 119 vulnerabilities, mostly the `react-scripts` 5 toolchain, which runs at build time.
  - Fixes are available, but they are dependency upgrades that need separate approval and testing.
- Fixed during this work:
  - Auth middleware rejects tokens without a valid user id; before, such a token could become an unfiltered lookup.
  - Registration no longer accepts arbitrary fields such as `role`.
  - Saving an existing user no longer re-hashes the password.
  - JSON body limit added.
  - Order access tokens use a separate signing key and audience.
- No new runtime or dev dependencies were added.

## Production blockers (must be resolved before release)

1. **Decisions D1–D6** (see `docs/manual-checkout-implementation.md`). Specifically:
   - D2: the receiving payment channel text for `ESCOWEAR_PAYMENT_INSTRUCTIONS`.
   - D3: a mail provider and sending identity (SPF/DKIM/DMARC), plus an approved adapter dependency. Without it every email, including tracking codes, stays queued.
   - D4: who becomes admin.
   - D5: refund, cancellation, delivery and duties policy.
   - D6: retention, plus token and code lifetimes.
   - Published terms and privacy wording; the checkout currently records `termsVersion=draft-2026-10`.
2. **Backup and restore**: no verified MongoDB backup and restore yet (already a known risk in the README). Needed before any production write.
3. **Indexes**: production connects with `autoIndex: false`. Run `npm run db:ensure-order-indexes` (additive only) after a backup and approval. Until the unique indexes exist, truly concurrent duplicate orders are not blocked at the database level.
4. **Legacy data assessment**: count and inspect existing `orders` documents read-only before release. Code reads legacy documents; no migration is needed or included.
5. **Rotate the leaked MongoDB credential** if it is still valid.
6. **Confirm the production MongoDB version** matches what was tested (7.0), using a read-only check.
7. **Deploy approval** following `DEPLOY-BEAST.md`, with runtime verification on Beast.
