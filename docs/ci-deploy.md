# GitHub Actions CI and manual Beast deployment

The deployment CI guard is implemented in Node.js (no Python required).

GitHub Actions runs `CI / verify` on every pull request and push to `master`. It runs the same Docker frontend test/lint stage, production build and isolated backend tests required by the existing release flow. CI uses no production database, mail settings or secrets.

## Protect master

In GitHub Settings → Branches (or Rulesets), protect `master` and require the status check **verify** from GitHub Actions before merging. Enable the rule after its first successful run. Branch protection cannot be configured by this repository code. Until enabled, GitHub does not prevent a failed PR from being merged.

## Deploy (manual, Beast only)

The production operator first approves the release, then runs `npm run deploy` in the existing registered Beast workspace. The script fast-forwards to `origin/master`, checks the exact commit against GitHub's **master push** CI run, and refuses deployment if the CI run is missing, pending or failed.

Create a GitHub fine-grained token scoped to **only this repository**, with **Actions: read** permission, and expose it privately as `ESCOWEAR_GITHUB_TOKEN` in the operator shell. Do not commit it or print it in logs. Example (the token is already in the shell environment):

```bash
npm run deploy
```

CI verification fails closed if the token is missing, authentication fails, GitHub is unavailable, or the current SHA has no successful `CI / verify` run. No push, PR, deployment or service restart happens automatically. Existing Docker tests, health checks and rollback remain intact; CI complements them rather than replacing them.

`npm run deploy:check` remains the current *read-only VPS preflight* and does not check GitHub CI; the CI gate is applied only in the actual deploy path. The deploy script does a fast-forward **before** checking CI, so even a refused release may update the local Git checkout; the live container is not replaced.

**Limit:** The guard verifies GitHub Actions reporting, not all possible production runtime problems. GitHub branch protection must be enabled separately for PR merge enforcement. Do not reuse a CI pass from another SHA, branch or pull request.
