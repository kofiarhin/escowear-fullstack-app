# Code review: MVP checkout preparation

Suggested PR title: **Prepare MVP checkout policies and release verification**

Branch: `prep/escowear-mvp-launch`

Base: `master` at `971e0358c42ea6ed5156473652f403b69fa4f2c8`.
This is a local review package; no remote PR, push, merge or deployment is authorized.

## Proposed description

The checkout needs policy content and repeatable release checks before its production
launch. This change fixes the five frontend lint errors, corrects registration labels,
and adds unpublished policy drafts with build-time publication checks. One configuration
file holds the temporary business details and the delivery wording used by checkout,
the policy page and policy emails.

The draft identifies EscoWear, Ghana, manual Mobile Money confirmation and delivery
confirmed individually after ordering. The address remains **To be confirmed** and
**support@escowear.com is unverified**. Policies remain **DRAFT**, hidden by default.
Publication is rejected until final seller details, mailbox verification, a final
policy version and publication approval are recorded. The template leaves the proposed
reply address unset and defaults to disabled email delivery.

The branch also defaults admin quote expiry to 48 hours, aligns policy email wording,
adds an offline launch configuration check, and includes the user-email unique index
in the operator's additive index setup script. The script has not been run against
production. CLI failure output avoids provider messages and duplicate-key values
that could disclose sensitive information.

## Review map

| Area | Files / focus |
|---|---|
| Editable business details | `client/src/policies/review.json`: temporary values, `approvedForPublication: false`, `emailVerified: false` |
| Policy visibility and wording | `client/src/policies/`, `client/src/Pages/Policies/`, checkout and footer links; no public draft-policy link by default |
| Publication guard | `client/scripts/check-policies.cjs`: rejects missing fields, placeholder address, unverified mailbox and draft version |
| Checkout/admin regressions | Registration labels, existing lint fixes, 48-hour quote default and user-visible-result assertions |
| Emails | `server/emails/templates.js`: shared delivery wording, version increment, policy promises gated by publication status |
| Configuration | `.env.example`, `compose.yaml`, `Dockerfile`: hidden-policy default, no proposed support mailbox activated, shared JSON included in runtime image |
| Release tooling | `server/scripts/releaseCheck.js`, `ensureOrderIndexes.js`, `emailCheck.js`; no execution of production mutations |
| Operational plan | `docs/mvp-launch-checklist.md`: release order, pending owner decisions and rollback that preserves orders |

To change draft business details, edit the JSON file above. Do not put credentials
or MoMo wallet secrets there: client metadata is public build input. Reset
`emailVerified` whenever the support address changes. Updating a business name does
not change the seller's legal identity or approve policy publication.

## Verification

- Frontend lint: passes with zero errors/warnings; the five lint fixes are preserved.
- Server tests: 69 passed; three opt-in database suites skipped in the default run.
- Frontend tests: 60 passed across 11 suites.
- `CI=true` React production build: hidden-policy artifact; publication of the current
  draft is intentionally rejected. A published release artifact remains blocked.
- `npm run release:check`: intentionally fails on missing launch configuration,
  seller details, placeholder address, unverified support email and policy approval.
- Prior preparation evidence: 24 disposable-MongoDB tests and 18 desktop/mobile browser
  checks passed before this placeholder update. Those are historical results, not
  evidence of current production acceptance.

No dependencies were installed or updated. The existing Browserslist data notice
remains. The Docker candidate image and Node 20 runtime still need their planned
checks; local checks use Node 22. Production Gmail delivery and support-mailbox
receipt/replies have not been verified. No production data or settings were changed.

## Launch requirements still open

1. Test support@escowear.com receipt and replies after explicit approval; authentication
   to an existing Gmail account does not prove this mailbox works.
2. Replace the address placeholder and provide final seller identity, legal status
   and phone. Complete policy/privacy review, including agreement to individual
   delivery terms; approve publication only when complete.
3. Verify the receiving MoMo network/number/account name privately, configure the
   public URL and mail delivery, and verify the intended sender and reply destination.
4. Verify a fresh recoverable backup, review existing data/indexes, provision the
   approved admin and additive indexes, then validate the fixed Docker candidate.
5. Obtain explicit release approval and follow the deployment/rollback checklist.

IDE-123 remains **deferred by owner decision, not fixed**. This review does not
authorize MongoDB credential changes or changes to dependent applications.

Next action: review this local branch and its diff. Code approval does not constitute
approval to publish policies, send email, change production configuration or deploy.
