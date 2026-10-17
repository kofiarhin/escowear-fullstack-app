# Beast preparation report — 2026-10-17 UTC

Workspace `/home/ubuntu/projects/escowear`, repository
`kofiarhin/escowear-fullstack-app`, base commit `d4cc1d7` with preparation
changes left uncommitted for review. Host: `vps-577d8682`.

## Infrastructure checks

- Host Nginx active; existing configuration passes `nginx -t`.
- Existing enabled sites: bangingprices.com, beast-api.devkofi.com,
  brain.devkofi.com, devkofi.com, ideahub-api.devkofi.com and vps-test-app.
- Three running Docker containers (DevKofi API/frontend and Brain) healthy.
  DevKofi API uses host networking; frontend and Brain publish only localhost
  8082 and 8081 respectively. They were neither restarted nor reconfigured.
- Docker requires sudo; Compose v5.5.1 available.
- Initial capacity: 3.7 GiB total RAM, about 2.0 GiB available; 4 GiB swap,
  192 MiB used. Root disk 38 GiB, about 12 GiB available. This is a shared host;
  recheck immediately before production startup.
- TCP 5080 free. 80/443 already belong to host Nginx. Other occupied ports
  include 3000, 3001, 3100, 3199, 4001, 5000, 8081 and 8082.
- Compose limits Escowear to 512 MiB, one CPU, 128 PIDs and localhost:5080;
  no additional MongoDB, external network, volume or public port is introduced.
- Existing Certbot renewal uses the Nginx plugin; certbot.timer is enabled.
  No Escowear certificate is present in the renewal inventory.
- DNS observations: escowear.com resolves to 192.64.119.135 and www to parking
  infrastructure (observed 2.59.170.19). Public routing is not ready.

## Problems found and addressed

- `.env` was mode 664: restricted to 600. It is ignored by Git and Docker.
- Missing JWT_SECRET prevented Compose interpolation: generated a persistent
  48-byte random key directly into `.env`, without displaying it.
- Initial image build failed with unknown ESLint environment `jest/globals`.
  Docker ignored the existing frontend lockfile and installed TypeScript 7.0.2,
  outside React Scripts 5's declared TypeScript 3/4 peer range. Pinned 4.9.5,
  refreshed the lockfile and switched the frontend to `npm ci`.
- Initial host backend tests lacked installed dependencies; final validation
  uses the image's dependencies rather than changing the host installation.
- Removed Git fetch/switch/pull commands from the old “read-only” preflight.

## Prepared configuration

- Root Dockerfile uses locked installs and provides a separate frontend-test target.
- Release Compose overlay selects fixed image `escowear:release-2026-10-17`
  without pulling.
- Separate HTTP/HTTPS Nginx templates pass isolated syntax validation. HTTPS
  validation used a temporary self-signed certificate; this is not live TLS
  validation. No template was installed into `/etc/nginx`.
- Read-only smoke script checks database identity/ping, catalogue and detail
  GET endpoints, health, HTML routes, compiled JavaScript and a local image.
- Auth/orders smoke test uses in-memory models only and covers registration,
  login/JWT issuance, authenticated order reads and writes, and password-hash
  redaction. It cannot modify MongoDB or existing customer data.

## Approval and remaining limits

Explicit owner approval is required before production container startup, DNS
edits, certificate issuance, installing/reloading Nginx for Escowear or any
public launch. See README.md for the staged sequence and rollback.

Auth registration/order writes, browser checkout, load testing, dependency
security audit, actual certificate issuance and renewal are not validated here.
Deprecated frontend dependencies and the Node 20 runtime require maintenance
review. Database backup/recovery arrangements must be confirmed before launch.
No production container, DNS record, active Nginx configuration or database
record was intentionally changed during preparation. No credentials are
included in this report or the committed configuration templates.

## Final results

- PASS: final Docker build; fixed release image `escowear:release-2026-10-17`,
  image ID `sha256:8a0a71ed0524f8dc10f32d1e4439fbf1645361a6122eb621bc75c99128eb3e48`,
  approximately 430 MB, runtime user `node`.
  approximately 431 MB, runtime user `node`.
- PASS: all six backend tests inside the image, with networking disabled.
- PASS: read-only MongoDB ping and expected database guard; catalogue contains
  3,258 products. Health, homepage, SPA route, compiled JavaScript, local default
  image, catalogue and product-detail responses passed in a disposable test
  container with no published ports. No database write capability was exercised.
- PASS: isolated registration, login, JWT, empty-order, order-creation and
  order-retrieval checks using disposable in-memory test data. Registration
  responses omit password hashes.
- PASS: release image `escowear:release-2026-10-17` builds with the minimized
  lockfile and is the image selected by the release Compose overlay.
- PASS: Compose validation with the actual private environment; existing host
  Nginx validation; isolated syntax checks for both proposed templates.
- PASS: frontend suite has 1 test suite and 4 tests passing. The former three
  failures were stale expectations for an older homepage, navigation URL and
  category query shape; the application behavior was preserved and the tests
  now assert the current website.
- Initial smoke harness failed to read the mode-600 secret with root plus all
  capabilities dropped; corrected to use the file owner's UID/GID and reran
  successfully without widening file permissions.
- Final observed capacity during the original preflight: 2.3 GiB available RAM,
  8.6 GiB available disk, 532 MiB swap used. Build caches and diagnostic images
  remain; no shared Docker images, caches or volumes were pruned.
- Existing three production Docker containers remain healthy, with unchanged
  uptimes. No Escowear production container is running.

Next: review compiler/dependency warnings and confirm backup arrangements, then
request approval for the concrete startup/DNS/HTTPS sequence in README.md. Public
TLS and external image loading still need validation at their appropriate stage.
