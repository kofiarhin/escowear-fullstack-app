# GitHub Actions CI and Beast deployment

The deployment CI guard is implemented in Node.js (no Python required).

GitHub Actions runs `CI / verify` and `CSS lint / css-lint` on every pull request and push to `master`. `CI / verify` runs the same Docker frontend test/lint stage, production build and isolated backend tests required by the release flow. CI uses no production database, mail settings or secrets.

## Protect master

In GitHub Settings → Branches (or Rulesets), protect `master` and require the status checks **verify** and **css-lint** before merging. Branch protection is configured in GitHub, not in this repository. Until those checks are required, GitHub does not stop a failing PR from being merged. A failing commit still cannot be deployed, because both deploy paths check CI themselves.

## How a deployment is gated

Every deployment, manual or automatic, runs `scripts/deploy.sh`. It refuses to continue unless the exact commit has a successful **master push** run of both `CI / verify` and `CSS lint / css-lint` (`scripts/check-ci.cjs`). A missing, pending or failed run, an older successful run, or a run from another branch, event or pull request does not count. It then keeps the existing protections: Docker tests, the checkout readiness check, saving the previous image, health checks, automatic rollback and project-only cleanup.

Since IDE-155 the release image is **built once in GitHub Actions** and published to Docker Hub; Beast pulls that exact image instead of building it (see [Release images on Docker Hub](#release-images-on-docker-hub)). `npm run deploy:build` keeps the old build-on-Beast path as a manual fallback.

### Automatic (`.github/workflows/deploy.yml`, inactive until enabled)

```text
push to master ─► CI ─┐ (each completion triggers Deploy)
                ─► CSS lint ─┘
Deploy workflow (GitHub)
  gate     1. ESCOWEAR_AUTO_DEPLOY == "true", event was a master push from this repository
           2. deploy-gate: commit is still the master tip, and both checks passed
                other check still running → wait (its completion re-triggers Deploy)
                newer commit on master   → superseded (no deploy)
                a check failed           → blocked (no deploy)
  publish  3. kofiarhin/escowear:<sha> already on Docker Hub → skip (built once per commit)
           4. build the release image (BuildKit, GitHub cache, policies "published"),
              run backend tests and the permission check in it, then push it
  deploy   5. (environment "production") ssh escowear-deploy@Beast "deploy <sha>"
Beast
  sshd     Match block: key only, forced command, no TTY/forwarding
  escowear-deploy-ssh   accepts only "check" or "deploy <40-hex>"
  sudo     escowear-deploy → ubuntu, only /usr/local/sbin/escowear-deploy-run
  escowear-deploy-run   private checkout only (/home/ubuntu/deploy), clean master,
                        only GitHub commits, sha == origin/master, single-flight lock
  scripts/deploy.sh     fast-forward to exactly the SHA, CI gate, pull
                        kofiarhin/escowear:<sha>, verify revision label and policy
                        status, test, swap, health, rollback
```

A failure at any step stops the run and fails the workflow: a failed publish skips the deploy job, and a failed pull, check or health check on Beast leaves (or restores) the previous release and returns a non-zero exit, which the deploy job reports as `::error::` and in the run summary.

**Overlap and stale commits.** Deploy jobs share one GitHub concurrency group: one runs at a time, and a newer queued request replaces an older queued one. The concurrency is set at the job level so skipped runs never cancel a queued deployment. On Beast, the wrapper's lock and `deploy.sh`'s lock refuse a second request while one is running, including a manual one. This holds because `deploy.sh` runs from only one checkout once the private checkout exists. An outdated commit is refused in three places: by the GitHub gate (the commit is not the master tip), by the wrapper (`sha != origin/master`) and by `deploy.sh`, which fast-forwards only to the requested SHA and refuses when `origin/master` has moved on, so the checkout never jumps to an unvetted commit. CI and CSS lint can both trigger a deploy for the same commit, so a release that is already live is a no-op (`ALREADY DEPLOYED`).

**Interrupted runs.** The wrapper runs `deploy.sh` in its own session. A dropped SSH connection or a cancelled or timed-out job cannot stop a release between replacing the container and the health/rollback steps.

**Public logs.** This repository is public, so its Actions logs are public. Beast returns only `[deploy]` status lines. The full build and deploy log stays on Beast in `/home/ubuntu/deploy/automation/logs/` (mode 600, last 30 kept). The GitHub token reaches only the CI check, never Docker or Compose.

### Release images on Docker Hub

| | |
|---|---|
| Repository | `kofiarhin/escowear` (private) |
| Tag | the full 40-character commit SHA, e.g. `kofiarhin/escowear:3f2c…`. No `latest`; tags are never reused, because publish skips a SHA that already exists. |
| Label | `org.opencontainers.image.revision=<sha>`; `deploy.sh` refuses an image whose label is not the commit it is deploying. |
| Image name | `DEPLOY_REGISTRY_IMAGE` in `scripts/deploy.conf`, read by both the publish job and `deploy.sh`. |
| Policy status | Built with `REACT_APP_POLICIES_STATUS=published` (`POLICIES_STATUS` in `deploy.yml`; production `.env` verified as `published` on 2026-11-19). `deploy.sh` refuses an image whose `ESCOWEAR_BUILD_POLICIES_STATUS` differs from the `.env` value, before the live container is touched. If production policies are ever unpublished, change `POLICIES_STATUS` in the same PR. |
| Push credentials | Variable `DOCKERHUB_USERNAME` and secret `DOCKERHUB_TOKEN` (read & write on this repository only), read only by the publish job, which runs in the master-only `production` environment. No Docker credential is on disk while repository code builds: the existence check calls the registry API directly, and `docker login` happens only after the image is built and tested, followed by `docker logout`. **Keep `DOCKERHUB_TOKEN` as a `production` environment secret, not a repository secret**: a repository secret is readable by any workflow run from a branch in this repository, and an existing `<sha>` tag is trusted without a rebuild. |
| Pull credentials | Root's Docker login on Beast (`sudo docker login`, stored in `/root/.docker/config.json`), used by `deploy.sh` through `sudo docker`. Use a **read-only** Docker Hub token here, separate from the GitHub push token. |
| Cache | BuildKit layers are cached in GitHub Actions (`scope=escowear-release`), so unchanged layers (such as `npm ci`) are reused between releases. |
| Retention on Beast | The pulled image is retagged as `escowear:release-<sha12>` and the registry name removed; the usual cleanup keeps the last 3 releases and one rollback image. Docker Hub keeps every published SHA; prune it there manually if storage matters. |

The restricted SSH interface is unchanged (`check` or `deploy <sha>`); Beast derives the image name from the SHA, so no image reference crosses the SSH boundary.

**First deploy after this change.** The Beast wrapper starts the checkout's *current* `deploy.sh` before fast-forwarding, so the first deploy after merging IDE-155 still builds on Beast with the old script (the deploy job keeps its 45-minute limit for that). The publish job still pushes the image. Every later deploy pulls.

**Outdated commits.** The deploy job reruns the gate just before SSH, so a commit that master overtook while its image was being published is skipped as `superseded` instead of failing.

**Setup** (each step needs Kofi's approval): the private Docker Hub repository `kofiarhin/escowear`; `DOCKERHUB_USERNAME` (variable) and `DOCKERHUB_TOKEN` (`production` environment secret, read & write); on Beast, `sudo docker login -u kofiarhin` with a separate **read-only** token. Check Beast's pull access read-only with `sudo docker manifest inspect kofiarhin/escowear:<published sha>`.

### Least privilege

| Account | Can | Cannot |
|---|---|---|
| GitHub gate/deploy jobs | read Actions status (`GITHUB_TOKEN`: `contents: read`, `actions: read`); SSH as `escowear-deploy` (deploy job only) | write the repository, choose the commands that run on Beast |
| GitHub publish job | push `kofiarhin/escowear` with `DOCKERHUB_TOKEN` | reach Beast (it holds no SSH secret) |
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

   It clones `master` from GitHub into `/home/ubuntu/deploy/escowear`, copies `.env` (mode 600) and `.deploy-state/{active.yaml,previous-image}`, then runs the read-only `deploy.sh --check` from there. Before copying, it checks that the release state consists of ubuntu-owned, mode-600 files and that `active.yaml` names the image that is actually running. From then on, `deploy.sh` refuses to run from any other checkout (`DEPLOY_PRODUCTION_ROOT` in `scripts/deploy.conf`). Manual deploys and rollbacks therefore use `/home/ubuntu/deploy/escowear`, and there is one lock and one release state for every deploy.

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
- Roll back the application: `npm run deploy:rollback` as `ubuntu` in `/home/ubuntu/deploy/escowear` (the checkout holding the current release state). It restarts the previous image kept on Beast (`.deploy-state/previous-image`), so it needs neither Docker Hub nor a rebuild. A failed health check after a swap already rolls back automatically.
- Go back to building on Beast: use `npm run deploy:build` for manual deploys. To stop automatic deploys while Docker Hub is unavailable, pause them as above.

## Manual deploy (Beast operator)

The manual path still works. After approving the release, run `npm run deploy` as `ubuntu` in the production checkout: `/home/ubuntu/deploy/escowear` once step 1 is done, `/home/ubuntu/projects/escowear` before that. Either export `ESCOWEAR_GITHUB_TOKEN` privately, or set `ESCOWEAR_GITHUB_TOKEN_FILE=/home/ubuntu/deploy/github-actions-read.token`. It fast-forwards to `origin/master`, applies the same CI and CSS lint gate, and pulls `kofiarhin/escowear:<sha>`, so the Deploy workflow's publish job must have finished for that commit. `npm run deploy:build` does the same but builds and tests the image on Beast instead of pulling (no Docker Hub needed). The fast-forward happens **before** the check, so a refused release can still update the local Git checkout; the live container is not replaced. `npm run deploy:check` is the read-only VPS preflight and does not check GitHub CI.

**Limit:** The gate trusts GitHub Actions' reported results; it does not catch every possible production runtime problem. Branch protection must be enabled separately to enforce checks on PR merges.
