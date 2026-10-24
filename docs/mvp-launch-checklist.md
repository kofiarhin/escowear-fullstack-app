# EscoWear checkout release preparation — 24 October 2026

Local branch: `prep/escowear-mvp-launch`, based on fetched master
`971e0358c42ea6ed5156473652f403b69fa4f2c8` (PRs #11–#17).
The existing local policy draft was carried onto this branch. No push, merge,
deployment, production configuration change or database write is authorized yet.

## Deferred by the owner (24 October 2026) — pending launch requirements

These are deferred, not resolved. Each one still blocks publishing the policies and
enabling live customer checkout:

- Final seller details: name, legal status, physical address and phone.
- Receipt-and-reply verification of support@escowear.com.
- Private EscoWear settings: Mobile Money instructions, public URL, SMTP enablement
  and the policy status.
- Legal review of the draft policies, then owner approval for publication.

Until then, policies stay `hidden`/DRAFT and checkout must not be launched.

## Current decision and gates

- **IDE-123 is deferred by the owner, not resolved.** Previous read-only verification
  found that the historical MongoDB credential still authenticates. Rotation remains
  the owner's responsibility. Do not change database credentials, JWT secrets or any
  dependent application as part of this release.
- **IDE-126 is unfinished.** The owner approved temporary draft details: EscoWear,
  Ghana, manual Mobile Money confirmation and delivery confirmed individually after
  ordering. The address is **To be confirmed**. The proposed support address is
  **support@escowear.com — UNVERIFIED**. Final seller identity, legal status, address
  and phone, mailbox verification and approval of the reviewed policy text remain needed.
  Privacy wording still needs applicable rights/complaints, processing basis,
  storage countries/transfers and retention procedures reviewed. Review how customers
  agree to individual delivery terms and the cancellation/faulty-goods wording before publication.
- Gmail credentials passed a login-only check on 24 October; no email was sent.
  This proves authentication, not sender authorization, inbox delivery or reply handling;
  it does not verify support@escowear.com.
  `EMAIL_TRANSPORT` is not enabled for SMTP in the current private configuration.
- Mobile Money instructions and `ESCOWEAR_PUBLIC_URL` are missing from the current
  private configuration. Never put a MoMo PIN, OTP or wallet password in instructions.
- Latest prior read-only production assessment: no users or orders; user collection
  lacked its unique email index, and checkout collections/indexes were not provisioned.
  Recheck at execution time; do not assume counts remain unchanged.
- Backup evidence from the preceding review: encrypted IDE-119 archive dated
  19 October, checksum verified, manifest records a successful isolated MongoDB
  8.0.34 restore with matching document/index hashes. This is historical recovery
  evidence, not a fresh pre-release backup. Same-host storage is not protection
  against host loss; the archive excludes database users/roles and oplog history.
- Dependency vulnerabilities recorded in the earlier audit remain unresolved;
  this branch makes no dependency upgrades. Docker image/runtime validation remains
  an execution gate; local tests use Node 22, while the Dockerfile uses Node 20.

## Local checks

Fresh verification on 24 October 2026:

| Check | Result |
|---|---|
| Frontend lint | 0 errors, 0 warnings (five errors fixed) |
| Server suite | 69 passed; 3 opt-in database suites skipped in this default run |
| Frontend suite | 60 passed across 11 suites |
| Real MongoDB suites, run separately | 24 passed on disposable MongoDB 7.0.14 |
| Production-build browser journey | 18 passed across desktop/mobile, with disposable MongoDB and captured fake mail |
| React production build | Passed with `CI=true`, policies hidden pending review |
| Compose configuration | `config --quiet` passed; no service changes |
| Published-policy build guard | Correctly rejects the current unapproved/incomplete draft |
| Gmail authentication | Passed; no message sent |
| Offline launch configuration | Blocked on the named settings and policy decisions above |

Browser coverage includes cart/checkout validation, receipt, isolation between
customers, admin quote/payment/fulfilment, rejected mismatched amounts, email outbox
and one-time-code tracking. It is not a live production payment test. Disposable
database files were removed and its test process stopped afterwards. No production
database or other application's service was changed. Test screenshots are ignored
local artifacts under `test-results/e2e/`. The older Browserslist data warning remains;
no dependencies were installed or updated. The candidate Docker image has not been built.
The final admin-test adjustment waits for the visible saved result rather than an
early fetch call; all 10 admin tests passed again without React act warnings.

Use installed dependencies; these commands do not require production writes:

```bash
ESCOWEAR_TEST_MONGO_URI= npm test
CI=true npm test --prefix client -- --watchAll=false --runInBand
npm run lint --prefix client
CI=true REACT_APP_POLICIES_STATUS=hidden npm run build --prefix client
npm run release:check
```

`release:check` is offline and prints only missing/invalid setting names. It is
expected to fail while the gates above are outstanding. It does not certify the
database target, credential permissions, Gmail deliverability or payment recipient.
The default server suite skips real-database tests unless explicitly configured.
Real-database/browser checks must use a disposable loopback database and fake mail.

The policy build guard rejects `published` until `client/src/policies/review.json`
contains final seller details, a verified support mailbox, a final version and
`approvedForPublication: true`. "To be confirmed" is rejected as a placeholder.
Do not set that flag merely to make a build pass. Hidden/draft builds are review
artifacts, not checkout launch candidates. Never deploy a draft policy build.

## Gmail and Mobile Money preparation

After separate approval to edit **only EscoWear's** private `.env`, preserve its
permissions and existing database/JWT values. Configure the settings in
[.env.example](../.env.example), following [email-setup.md](email-setup.md):

| Setting | Intended value / verification |
|---|---|
| `EMAIL_TRANSPORT` | `smtp`; enabling the worker can send queued messages immediately |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | `smtp.gmail.com`, `465`, `true` |
| `SMTP_USER`, `SMTP_PASS` | Existing sending mailbox and Gmail App Password, stored privately |
| `EMAIL_FROM` | Owner-approved sending identity accepted by Gmail |
| `EMAIL_REPLY_TO` | Proposed: support@escowear.com, **UNVERIFIED**. The template leaves this unset until receipt and replies are tested. |
| `ESCOWEAR_PUBLIC_URL` | `https://escowear.com` |
| `ESCOWEAR_PAYMENT_INSTRUCTIONS` | Approved MoMo network, receiving number and account name; use literal `\n` between lines |
| `ESCOWEAR_POLICIES_STATUS` | `published` only after reviewed content and seller details are complete |

Temporary business details live in `client/src/policies/review.json`; there is no
separate business-details environment copy to keep in sync. `.env.example` documents
the placeholders and defaults to `EMAIL_TRANSPORT=none`. The private `.env` and the
running application's settings have not been edited.

The MoMo flow is manual; no payment gateway or automatic payment confirmation is
included. The owner must independently verify the recipient number and account name.
Quote emails ask for the exact GHS amount and order-number reference. A screenshot
does not confirm receipt: admin must check the receiving wallet, transaction reference
and exact amount before confirming payment. Do not enter invented successful payments.

Use `npm run email:check` for authentication only. An explicit owner-approved test
email (`npm run email:check -- --send-to <owner-test-address>`) is still required:
check inbox/spam, sender, reply destination and HTTPS tracking link. Test an actual
reply. Do not send to customers during release verification. Inspect queued-message
counts/states before enabling SMTP; handle any existing queue deliberately.

## Deployment order — execute only after explicit approval

1. Finish policy review and public seller details; update `review.json`, then rerun
   lint, tests and a **published** production build. Owner reviews the diff and test
   evidence. Push/PR/merge are separate approved steps; record the resulting release SHA.
2. Record the current container image ID, revision and Compose files from live
   metadata. Preserve that image and the actual current configuration privately
   (mode 600) before editing anything. Do not rely on the historical initial-release
   overlay. Recheck free disk/RAM; do not prune shared Docker resources.
3. Recheck database connectivity, database name, collection/index metadata, user/order
   counts and duplicate emails using read-only operations. Take a fresh encrypted
   backup after approval; verify checksum and restore into an isolated target, never
   production. Ensure the owner has the key and an independent copy. Any failure stops
   execution before indexes, registration or deployment.
4. Prepare EscoWear-only mail, public URL, payment and approved policy configuration.
   Leave database credentials unchanged. Run `npm run release:check`. Validate the
   actual reviewed Compose stack with `config --quiet`; never print resolved config.
5. Build and retain a fixed candidate image from the approved SHA, passing
   `REACT_APP_POLICIES_STATUS=published`. Do not reuse a mutable `latest` tag.
   Run Docker's frontend-test target and server tests using the intended runtime;
   verify candidate health locally with isolated data/mail before replacing the live
   service. No production side effects are permitted during that candidate check.
6. With explicit database-write approval, run the candidate's additive index script
   **before accepting registrations or orders**. It now includes the user-email
   unique index as well as order/event/outbox/tracking indexes. Verify names, keys,
   uniqueness and TTL against the models. Duplicate-key failure is a stop condition;
   never delete customer records to force an index to build.
7. Replace only EscoWear's `web` service using the fixed image. Expect a brief
   interruption with this single-container deployment. No shared Nginx, DNS, other
   apps, importer or scraper changes are part of this release.
8. Owner registers the designated account, then the approved operator grants its
   stored admin role. Sign out/in and verify `/admin/orders`; a customer and signed-out
   browser must be denied. Do not enable general launch until this operational path works.
9. Check localhost/public health, catalogue, HTTPS, policy links/version, mobile and
   desktop checkout, Gmail delivery/replies and admin workflow. Any live test order
   must be explicitly approved, use owner-controlled contact details and remain
   clearly recorded as a test; never claim payment without actual received funds.
10. Monitor failures, outbox states, new orders, memory and health. Record deployed
    image/SHA and results. Do not mark IDE-123 or IDE-126 complete without their evidence.

After the approved operator sets `ESCO_RELEASE_OVERLAY` to the reviewed fixed-image
overlay and `ESCO_ADMIN_EMAIL` privately, the service-scoped commands are:

```bash
esco_compose=(sudo docker compose -f compose.yaml -f "$ESCO_RELEASE_OVERLAY")
"${esco_compose[@]}" config --quiet
# Production database writes: separate approval and verified backup first.
"${esco_compose[@]}" run --rm --no-deps -T web node server/scripts/ensureOrderIndexes.js
# Service replacement: deployment approval first.
"${esco_compose[@]}" up -d --no-deps --no-build web
# Only after the owner has registered, and specifically approved this admin identity.
"${esco_compose[@]}" exec -T web node server/scripts/setUserRole.js --email "$ESCO_ADMIN_EMAIL" --role admin --confirm
curl -fsS http://127.0.0.1:5080/health
curl -fsS https://escowear.com/health
```

These are an execution checklist, not commands already performed. Keep role-change
output private because the existing operator script prints the selected email.

## Rollback

- Stop release progression on failed health, database errors, authentication bypass,
  incorrect payment details, or failed critical email delivery. Seek approval before
  changing production again; preserve diagnostics without customer details/secrets.
- Recreate **only EscoWear `web`** using the saved prior image and its matching private
  configuration/Compose files. Keep new database records and additive indexes.
  Do not restore the whole database or delete orders for an application/config failure.
- The prior deployed image predates this checkout: it may not display/manage new
  orders or send their queued emails. Reverting the image therefore does not undo
  the business obligations. Record affected order IDs privately, prevent further
  checkout intake using an approved maintenance action if necessary, and arrange
  owner follow-up/refunds. Never mark unsent mail as delivered.
- Verify health, catalogue and login after rollback. Keep the failed image and
  evidence for diagnosis, and obtain approval for a corrected release.

## Next action

Review the local branch using [mvp-code-review.md](mvp-code-review.md). Approval of
this code does not approve publication or deployment. The subsequent operational
step is an explicitly approved test of receipt and replies for support@escowear.com;
leave it unverified until that succeeds. Final address/seller details, policies,
payment configuration, recovery and admin/index gates still apply. No production
action has been performed by this preparation branch.
