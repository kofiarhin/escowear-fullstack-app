# Escowear — Beast production operations

**Live deployment reported and browser-checked October 2026.** This is an operations guide for an **existing** deployment, not an instruction to perform a fresh public launch.

- Public: https://escowear.com (primary) and https://www.escowear.com (redirect to primary, as reported by Codex)
- VPS checkout: `/home/ubuntu/projects/escowear` (verify live)
- GitHub repository: `kofiarhin/escowear-fullstack-app`, release code on `master`
- Container: `escowear-web-1`, Compose project `escowear`
- Release image at initial launch: `escowear:release-2026-10-17` (do not assume it is always current)
- Private upstream: `127.0.0.1:5080` to container port `5000`
- Web server: Beast host Nginx, HTTPS via Let's Encrypt/Certbot
- DB: existing `escowear-sneaker-import-test`, not a newly provisioned MongoDB container

## Read-only status checks

First verify the current checkout and remote. Do not discard local changes.

```bash
cd /home/ubuntu/projects/escowear
git status --short
git branch --show-current
git config --get remote.origin.url
git rev-parse --short HEAD
sudo docker compose -f compose.yaml -f deploy/beast/compose.release.yaml ps
sudo docker ps --filter name=escowear --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -fsS http://127.0.0.1:5080/health
sudo nginx -t
```

External checks (avoid creating test customers/orders on production):

```bash
curl -fsSI https://escowear.com/
curl -fsS https://escowear.com/health
curl -fsSI https://www.escowear.com/
```

A successful health endpoint confirms that the backend currently sees its MongoDB connection as ready; verify catalogue behavior separately. Inspect logs without dumping environment variables:

```bash
sudo docker logs --tail 100 escowear-web-1
```

## Deployment and rollback rules

Any future application release needs a reviewed Git commit, a versioned/tested image, and **separate approval** before changing the running container or host Nginx/DNS/HTTPS. Never automatically run `docker compose up -d --build` against production. Use the existing [release overlay and instructions](deploy/beast/README.md) as a reference, but re-check the actual live image, ports, disk, Compose config, and Nginx site first.

For rollback, preserve the previously tested image identifier and deployment configuration. Roll back only the Escowear Compose service and its Nginx site after approval; never restart unrelated services, prune shared images/volumes, or overwrite MongoDB.

## Launch verification and known limits

At launch, Codex reported: Docker health green; read-only MongoDB smoke with 3,258 products; frontend tests 4/4; backend tests 6/6; isolated auth/order smoke passed; public HTTPS homepage, product API, image and health endpoint successful; `www` operational; Certbot renewal dry-run successful. Owner browser screenshots independently confirmed homepage and `/store` sneaker images, GBP prices and sizes. See [the preparation report](deploy/beast/REPORT.md) for pre-launch findings, which are historical and should not be treated as today's state.

**Current checkout release:** follow [the current launch checklist](docs/mvp-launch-checklist.md). The initial launch proceeded without a verified backup; later IDE-119 evidence records an encrypted backup and isolated restore. Recheck recovery readiness before this release. Earlier reports of credential rotation do not establish remediation: the historical MongoDB credential was subsequently verified as valid. IDE-123 is now deferred by the owner. Do not change credentials or dependent apps as part of checkout preparation, or store secrets in logs, docs or issues.

## Infrastructure reconciliation

A permanent Nginx site/container was added to Beast. Reconcile the canonical `kofiarhin/beast/VPS-Beast-AI-Agent-Profile.md` using the **existing** profile updater and live VPS evidence; do not reconstruct or manually override runtime facts. Record state and verification in Linear issue **IDE-112**.
