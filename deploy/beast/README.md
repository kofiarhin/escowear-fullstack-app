# Escowear on Beast — operating guide

**Current phase: live MVP (October 2026).** The steps below distinguish what was completed at launch from what would require a **new approval** for later releases.

## Deployment architecture

```text
Namecheap DNS: @ -> 51.68.196.59, www -> escowear.com
      Beast host Nginx / Let's Encrypt HTTPS
                   |
              127.0.0.1:5080
                   |
       Compose: escowear-web-1
          Express + built React
                   |
   MongoDB: escowear-sneaker-import-test
```

`compose.yaml` sets a 512 MiB RAM / 1 CPU / 128 PID limit and localhost-only publishing. `compose.release.yaml` selects the **initial release** image tag `escowear:release-2026-10-17`; that tag is historical, not a moving latest release. The live image digest and currently deployed revision should be checked before changes. Beast's other services are separate and must not be affected.

## Files in this folder

- `compose.release.yaml`: fixed-image overlay for the initial Beast release.
- `escowear.http.conf`: temporary HTTP/ACME site template used before HTTPS was issued.
- `escowear.https.conf`: HTTPS proxy and www redirect template; **verify installed Nginx files against live configuration before reusing**.
- `smoke.cjs`: read-only MongoDB / storefront smoke tests.
- `auth-orders-smoke.cjs`: isolated in-memory authentication and order tests (guest-checkout contract, IDE-114), **not** a live checkout test.
- `../../e2e/`: isolated browser smoke for the full manual-checkout journey (in-memory models, fake data); see `docs/release-readiness-manual-checkout.md`.
- `REPORT.md`: original preparation evidence (2026-10-17); it deliberately preserves the state **before** launch.

## Verify the running site (read-only)

```bash
cd /home/ubuntu/projects/escowear
git status --short
sudo docker compose -f compose.yaml -f deploy/beast/compose.release.yaml ps
curl -fsS http://127.0.0.1:5080/health
curl -fsSI https://escowear.com/
sudo nginx -t
```

Use `sudo docker` on Beast. Inspect current container name, image, and release settings before assuming they match this document. The public site and product catalogue were browser-checked in October 2026; run current checks for live health.

## Subsequent deployments (approval required)

1. Confirm clean Git state, intended commit and repository identity; keep unrelated work.
2. Review code, tests, locked dependencies, build and image tag; retain the previous working image for rollback.
3. Check free disk/memory, container health and occupied ports. Do **not** prune Docker caches/volumes or restart other apps.
4. Confirm private root `.env` remains mode 600, with the required `ESCOWEAR_MONGO_URI` and `JWT_SECRET`. Never show or copy values into logs or issues.
5. After owner approves **deployment separately from code changes**, update only Escowear's Compose service using a reviewed fixed image reference. Validate `docker compose ... config --quiet` before applying changes.
6. Check localhost `/health`, catalogue, product images, public HTTPS, `www` redirect and existing Beast sites; record results.
7. For Nginx, certificates, DNS, domain or port changes, request **new explicit approval**. Run `nginx -t` before any approved reload. Certbot renewal is managed by Beast's host configuration; check live renewal status rather than assuming it works indefinitely.

Do not use the initial launch instructions to overwrite the current host virtual host or reissue an existing certificate.

## Rollback

On a failed application release, first inspect symptoms and preserve logs. With approval, restore the last verified Escowear image/configuration and validate its health. Touch only the Escowear container and vhost; do not change shared Docker services, PM2, firewall, MongoDB or other applications.

## Verified launch evidence vs. outstanding checks

**Reported by Codex:** Escowear container healthy on localhost 5080; read-only DB/product checks for 3,258 records; Nginx and two-domain HTTPS configured; certificate renewal dry-run passed; existing Beast apps stayed healthy. **Confirmed by owner's browser screenshots:** HTTPS homepage and store catalogue display sneaker photos, GBP prices and sizes.

**New checkout:** automated isolated tests cover product, cart, checkout, admin and tracking; live registration, payment and email acceptance still need approval and verification. The initial MVP launched without a verified backup; subsequent IDE-119 recovery evidence and current release gates are recorded in [the launch checklist](../../docs/mvp-launch-checklist.md). IDE-123 credential remediation is deferred by the owner. Older dependencies and limited shared VPS disk remain concerns.

After permanent VPS changes, run and verify Beast's established profile reconciliation workflow and update the Linear execution record.
