# Release readiness — manual checkout (IDE-114 to IDE-118)

**Date:** 21 October 2026
**Status:** Verified locally in isolation. **Not released.** Production is blocked by the items below.
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
| Server unit/API tests (in-memory models) | `npm run test:server` | **52/52 pass** |
| Importer tests | `npm run test:importer` | **3/3 pass** |
| Client tests | `CI=true npm test --prefix client -- --watchAll=false` | **45/45 pass**, 9 suites, no act() warnings |
| Client production build | `npm run build --prefix client` with `CI=false`, as the Dockerfile does | **Compiles.** 3 warnings, all pre-existing in untouched files (Register, Logout, user reducer). `CI=true` builds fail on these pre-existing warnings, on `master` too. |
| Full API journey | `server/tests/e2eCheckout.test.js` | **Pass.** Cart → order with double submit → acknowledgement during a provider outage, then retry → GHS quote → proof → bank verification → dispatch → code tracking → completed, with no duplicate emails. |
| Browser smoke, headless Chromium, desktop 1280×860 and mobile 390×844 | `PLAYWRIGHT_CORE_PATH=… npm run test:e2e` | **18/18 checks pass** |
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

## Test limitations

- All persistence tests use an in-memory stand-in for Mongoose (`server/tests/helpers/memoryModel.js`). Mongoose schema validation is tested directly, but **no test has run against a real MongoDB**. No local MongoDB, Docker access or `mongodb-memory-server` is available without new approvals. Recommended: approve `mongodb-memory-server` as a dev dependency, or a throwaway MongoDB container, and run the suites against it before release.
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
6. **Real-DB test run** (see Test limitations).
7. **Deploy approval** following `DEPLOY-BEAST.md`, with runtime verification on Beast.
