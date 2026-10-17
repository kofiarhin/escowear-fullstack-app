# Escowear — Beast deployment checklist

Updated preparation and approval-gated commands: [deploy/beast/README.md](deploy/beast/README.md).
Results from this preparation: [deploy/beast/REPORT.md](deploy/beast/REPORT.md).

Target: `escowear.com` / `www.escowear.com`. This repository prepares the container **only**. No DNS, Nginx, certificate or VPS service change has been performed.

## Matches Beast's existing architecture

- One Docker Compose application, with a unique `escowear` project name.
- Node/Express serves the built React website and same-origin `/api` routes.
- Published only on `127.0.0.1:5080` by default. Existing host Nginx will proxy HTTPS to this address **after separately approved configuration**.
- Does not start MongoDB or affect other Docker services, PM2 apps, or systemd units.
- Existing MongoDB database: **`escowear-sneaker-import-test`** (configured target; public launch still requires approval); no migration, data copy or database creation.
- Production requires `ESCOWEAR_MONGO_URI` and `JWT_SECRET`. Store them in a private, gitignored `.env` on Beast. Never print secrets or check them into Git.
- Runtime limit: 512 MiB RAM, 1 CPU; verify capacity before the build, which needs more memory than runtime.

## Read-only preflight on Beast

Verify the registered Escowear workspace and repository identity first. Do not guess its absolute path or overwrite an existing checkout. In the verified repository directory, inspect the state:

```bash
git status --short
git config --get remote.origin.url
git rev-parse --short HEAD
sudo docker --version
sudo docker compose version
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -ltn | grep ':5080 ' || true
free -h
df -h /
```

Stop if Git has unrelated changes, if the origin is not `kofiarhin/escowear-fullstack-app`, or if port 5080 is in use. Beast currently uses `sudo docker`; do not alter Docker group membership.

## Local-only verification (no public traffic)

After confirming port/resource availability, create the private `.env` securely, containing `ESCOWEAR_MONGO_URI` (existing DB) and `JWT_SECRET` (strong random value). Do not paste secret values in chat or Linear.

```bash
chmod 600 .env
sudo docker compose config --quiet
sudo docker compose build
```

Building an image does not start the service. Both build stages now use `npm ci` and committed lockfiles. TypeScript is pinned to 4.9.5 to match React Scripts 5 tooling. The frontend validation target now passes all four frontend tests.

## Starting the service — requires separate production approval

```bash
sudo docker compose up -d --no-build
sudo docker compose ps
curl -fsS http://127.0.0.1:5080/health
curl -fsS http://127.0.0.1:5080/api/products?page=1\&limit=1
```

Do **not** run these production startup commands before approval and a live check of other services.

## Public launch — separate approval

Review Namecheap A/AAAA records, Beast's existing Nginx sites and Certbot pattern, then request permission for any DNS, Nginx, HTTPS or public launch changes. Reverse proxy `escowear.com` to `http://127.0.0.1:5080`; redirect `www.escowear.com` to apex. Never publish port 5080 publicly.

Verify HTTPS, homepage, catalogue, product images, auth, and order flows. Retain the previous image/commit and MongoDB backup before release. After permanent VPS changes, reconcile the canonical Beast profile and Linear issue.
