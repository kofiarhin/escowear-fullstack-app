# GitHub Actions CI and Beast deployment

The deployment CI guard is implemented in Node.js (no Python required).

GitHub Actions runs `CI / verify` and `CSS lint / css-lint` on every pull request and push to `master`. `CI / verify` runs the same Docker frontend test/lint stage, production build and isolated backend tests required by the release flow. CI uses no production database, mail settings or secrets.

## Protect master

In GitHub Settings → Branches (or Rulesets), protect `master` and require the status checks **verify** and **css-lint** before merging. Branch protection is configured in GitHub, not in this repository. Until those checks are required, GitHub does not stop a failing PR from being merged. A failing commit still cannot be deployed, because both deploy paths check CI themselves.

## How a deployment is gated

Every deployment, manual or automatic, runs `scripts/deploy.sh`. It refuses to build unless the exact commit has a successful **master push** run of both `CI / verify` and `CSS lint / css-lint` (`scripts/check-ci.cjs`). A missing, pending or failed run, an older successful run, or a run from another branch, event or pull request does not count. It then keeps the existing protections: Docker tests, the checkout readiness check, saving the previous image, health checks, automatic rollback and project-only cleanup.

### Automatic (`.github/workflows/deploy.yml`, inactive until enabled)

```text
push to master ─► CI ─┐ (each completion triggers Deploy)
                ─► CSS lint ─┘
Deploy job (GitHub, environment "production")
  1. ESCOWEAR_AUTO_DEPLOY == "true", event was a master push from this repository
  2. deploy-gate: commit is still the master tip, and both checks passed
       other check still running → wait (its completion re-triggers Deploy)
       newer commit on master   → superseded (no deploy)
       a check failed           → blocked (no deploy)
  3. ssh escowear-deploy@Beast "deploy <sha>"
Beast
  sshd     Match block: key only, forced command, no TTY/forwarding
  escowear-deploy-ssh   accepts only "check" or "deploy <40-hex>"
  sudo     escowear-deploy → ubuntu, only /usr/local/sbin/escowear-deploy-run
  escowear-deploy-run   private checkout only (/home/ubuntu/deploy), clean master,
                        only GitHub commits, sha == origin/master, single-flight lock
  scripts/deploy.sh     fast-forward to exactly the SHA, CI gate, build, test,
                        swap, health, rollback
```

**Overlap and stale commits.** Deploy jobs share one GitHub concurrency group: one runs at a time, and a newer queued request replaces an older queued one. The concurrency is set at the job level so skipped runs never cancel a queued deployment. On Beast, the wrapper's lock and `deploy.sh`'s lock refuse a second request while one is running, including a manual one. An outdated commit is refused in three places: by the GitHub gate (the commit is not the master tip), by the wrapper (`sha != origin/master`) and by `deploy.sh`, which fast-forwards only to the requested SHA and refuses when `origin/master` has moved on, so the checkout never jumps to an unvetted commit. CI and CSS lint can both trigger a deploy for the same commit, so a release that is already live is a no-op (`ALREADY DEPLOYED`).

**Interrupted runs.** The wrapper runs `deploy.sh` in its own session. A dropped SSH connection or a cancelled or timed-out job cannot stop a release between replacing the container and the health/rollback steps.

**Public logs.** This repository is public, so its Actions logs are public. Beast returns only `[deploy]` status lines. The full build and deploy log stays on Beast in `/home/ubuntu/deploy/automation/logs/` (mode 600, last 30 kept). The GitHub token reaches only the CI check, never Docker or Compose.

### Least privilege

| Account | Can | Cannot |
|---|---|---|
| GitHub job | read Actions status (`GITHUB_TOKEN`: `contents: read`, `actions: read`); SSH as `escowear-deploy` | write the repository, choose the commands that run on Beast |
| `escowear-deploy` | run `escowear-deploy-run check` or `deploy <sha>` as `ubuntu` | open a shell or TTY, forward ports, use Docker or other sudo, read `/home/ubuntu`, edit its own `authorized_keys` (root-owned) |
| `ubuntu` (the wrapper) | the existing deploy path (`sudo docker` for the `escowear` Compose project only, via `deploy.sh`) | — unchanged |
| `beast-agent` | work in `/home/ubuntu/projects/escowear` as before | reach `/home/ubuntu/deploy`, so it cannot change what automation runs |

No ACL on `/home/ubuntu` is needed and none is granted. The wrapper is root-owned in `/usr/local/sbin`, so the deploy account cannot change it.

**Why a separate checkout.** `/home/ubuntu/projects` and the development checkout are writable by the sandboxed `beast-agent` account, which can rename directories, rewrite scripts, or hide edits from `git status`. Running that tree as `ubuntu` (which has full sudo) from an unattended trigger would let `beast-agent` reach root. Automatic deploys therefore run only from `/home/ubuntu/deploy/escowear`. The wrapper refuses to start unless `/home/ubuntu/deploy` is owned by `ubuntu`, has mode 700 with no ACLs, and has no ancestor directory that anyone else can write to. As defence in depth, it also ignores system and global Git config, replace refs, repository hooks and fsmonitor, and it refuses a dirty checkout or local commits that are not on GitHub.

### One-time setup (each step needs Kofi's approval)

1. **Create the private production checkout** (as `ubuntu`; it copies `.env` and the release state without printing them, and touches no container):

   ```bash
   bash deploy/beast/automation/setup-private-checkout.sh
   ```

   It clones `master` from GitHub into `/home/ubuntu/deploy/escowear`, copies `.env` (mode 600) and `.deploy-state/{active.yaml,previous-image}`, then runs the read-only `deploy.sh --check` from there. From then on, run manual deploys and rollbacks from `/home/ubuntu/deploy/escowear`. Once a release is made from the new checkout, the old checkout's state goes stale, and `deploy.sh` there refuses with "Live release drift detected" instead of deploying.

2. **Install the restricted SSH path on Beast.** This changes sshd and sudo for `escowear-deploy` only. From a clean `master` checkout that contains this change:

   ```bash
   sudo deploy/beast/automation/install.sh
   ```

   It validates the sudoers file (`visudo`), confirms `sshd -t` passes and that `ForceCommand` applies to `escowear-deploy` but not to `ubuntu`, then reloads `ssh`. It also confirms that sudo allows `check` and `deploy <sha>` and refuses wider commands (`--rollback`, shells, Docker, uppercase or injected SHAs). If any step fails, it reverts everything it changed: the sshd block (reloading `ssh` again if it already had), the sudoers rule, the wrappers, the original `.ssh` directory and the original shell. It restricts the existing key (`restrict,command=...`), makes `authorized_keys` root-owned, and sets the account's shell to `/bin/sh`.

3. **CI-gate token on Beast.** Create a fine-grained GitHub token for **only** `kofiarhin/escowear-fullstack-app` with **Actions: read**, and save it without echoing it:

   ```bash
   ( umask 077; read -rs -p 'Token: ' t; printf '%s\n' "$t" > /home/ubuntu/deploy/github-actions-read.token; unset t; echo )
   ```

4. **GitHub environment and secrets.** Create the environment `production` and limit its deployment branches to `master`. Then add these environment secrets (values are never printed):

   ```bash
   R=kofiarhin/escowear-fullstack-app
   gh secret set BEAST_SSH_PRIVATE_KEY --env production -R $R < ~/.ssh/escowear_deploy
   gh secret set BEAST_SSH_HOST --env production -R $R --body 51.68.196.59
   # Pin Beast's real host key (taken from the server itself, not ssh-keyscan):
   printf '51.68.196.59 %s\n' "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)" \
     | gh secret set BEAST_SSH_KNOWN_HOSTS --env production -R $R
   ```

   After the upload, delete the private key from Beast: `shred -u ~/.ssh/escowear_deploy`. GitHub then holds the only copy. To rotate the key, generate a new key pair, replace the key in `authorized_keys`, rerun `install.sh` and reset `BEAST_SSH_PRIVATE_KEY`.

5. **Read-only test.** Run **Actions → Deploy → Run workflow** on `master`. Manual runs only send `check`, which runs the read-only `deploy.sh --check` preflight on Beast and never deploys.

6. **Activate.** Set the repository variable `ESCOWEAR_AUTO_DEPLOY` to `true`. Until then, every automatic Deploy run is skipped.

### Turn off or roll back

- Pause automatic deploys immediately: set `ESCOWEAR_AUTO_DEPLOY` to anything other than `true`, or delete it.
- Remove server access: `sudo deploy/beast/automation/install.sh --uninstall`. This removes the sshd block (and reloads `ssh`), the sudoers rule and both wrappers.
- Roll back the application: `npm run deploy:rollback` as `ubuntu` in `/home/ubuntu/deploy/escowear` (the checkout holding the current release state).

## Manual deploy (Beast operator)

The manual path still works. After approving the release, run `npm run deploy` as `ubuntu` in the production checkout: `/home/ubuntu/deploy/escowear` once step 1 is done, `/home/ubuntu/projects/escowear` before that. Either export `ESCOWEAR_GITHUB_TOKEN` privately, or set `ESCOWEAR_GITHUB_TOKEN_FILE=/home/ubuntu/deploy/github-actions-read.token`. It fast-forwards to `origin/master` and applies the same CI and CSS lint gate. The fast-forward happens **before** the check, so a refused release can still update the local Git checkout; the live container is not replaced. `npm run deploy:check` is the read-only VPS preflight and does not check GitHub CI.

**Limit:** The gate trusts GitHub Actions' reported results; it does not catch every possible production runtime problem. Branch protection must be enabled separately to enforce checks on PR merges.
