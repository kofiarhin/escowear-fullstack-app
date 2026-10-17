# Beast deployment preparation

Nothing in this directory is installed automatically. Public launch, production
container startup, DNS edits, certificate issuance and Nginx changes require the
owner's explicit approval.

## Prepared files

- `compose.release.yaml`: overlay selecting the tested local image; run with the root `compose.yaml`.
- `escowear.http.conf`: certificate bootstrap vhost, serving only ACME challenges and otherwise HTTP 503.
- `escowear.https.conf`: apex HTTPS proxy to localhost:5080 and www redirect.
- `smoke.cjs`: read-only database/application smoke test, run inside a disposable container without published ports.

## Safe verification

From `/home/ubuntu/projects/escowear`:

```sh
sudo docker build -t escowear:release-2026-10-17 .
# The separate validation target runs all frontend tests before returning success.
sudo docker build --target frontend-test -t escowear:frontend-test .
sudo docker run --rm --network none --memory 512m --cpus 1 --pids-limit 128 escowear:release-2026-10-17 npm run test:server
sudo docker run --rm --memory 512m --cpus 1 --pids-limit 128 --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --read-only --mount type=bind,src="$PWD/.env",dst=/run/escowear.env,readonly --mount type=bind,src="$PWD/deploy/beast/smoke.cjs",dst=/tmp/smoke.cjs,readonly escowear:release-2026-10-17 node /tmp/smoke.cjs
sudo docker run --rm --network none --memory 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges --read-only --mount type=bind,src="$PWD/deploy/beast/auth-orders-smoke.cjs",dst=/tmp/auth-orders-smoke.cjs,readonly escowear:release-2026-10-17 node /tmp/auth-orders-smoke.cjs
```

The smoke container runs with the workspace owner UID to read the owner-only
secret file, drops all capabilities, has a read-only filesystem, and exposes no host port. It uses
a temporary JWT key and never prints credentials or database records. It uses
the application's DB connection guard and disables automatic index/collection
creation. Registration/order writes are deliberately outside this test.

The auth/orders smoke test does not connect to MongoDB. It injects in-memory
test models, uses a random test JWT secret, and discards all test data when the
container exits. It covers registration, login/JWT issuance, authenticated empty
orders, order creation, order retrieval, and confirms registration does not
return a password hash.

## Approval-gated launch sequence

1. A strong random persistent `JWT_SECRET` has been created in the gitignored mode-600 `.env`. Preserve it securely; never print or paste the value. Use only the Escowear DB URI in runtime configuration; do not forward the importer source URI. Confirm backup/recovery arrangements for the existing database.
2. Recheck memory, disk, localhost port 5080 and existing service health. Preserve the tested image ID and git commit. Validate the fixed release image and Compose configuration with `sudo docker compose -f compose.yaml -f deploy/beast/compose.release.yaml config --quiet` (never print expanded config).
3. After explicit production-start approval, run `sudo docker compose -f compose.yaml -f deploy/beast/compose.release.yaml up -d --no-build --pull never`. Verify localhost health/catalogue before public routing. No MongoDB service or shared Docker network is required.
4. After DNS approval, point apex and www to Beast's verified public address. Remove conflicting A/AAAA/CNAME/forwarding records as appropriate. Do not guess IPv6. Check both names resolve correctly externally.
5. After Nginx/HTTPS approval, ensure neither name is configured elsewhere; back up current Nginx configuration. Create `/var/www/escowear-acme`, install the HTTP template as a new site and enable only that site. Run `sudo nginx -t` before a graceful reload; never replace the main configuration or another application's vhost.
6. Issue a certificate using `sudo certbot certonly --webroot -w /var/www/escowear-acme -d escowear.com -d www.escowear.com`. This scoped webroot method avoids automatic edits to other vhosts. Existing sites use Certbot's Nginx plugin; verify a deploy hook reloads Nginx after successful renewals for this webroot certificate.
7. Install the HTTPS template only after certificate issuance. Test Nginx, then reload. Verify HTTPS certificate names, www redirect, homepage, catalogue, product images and authorized auth/order flows. Test certificate renewal with `sudo certbot renew --cert-name escowear.com --dry-run`.
8. Check all pre-existing sites and containers still operate. Record the deployment in the host's operational inventory.

Rollback: remove only the new Escowear enabled-site link, validate and reload
Nginx, then stop only the Escowear Compose project. Restore DNS only if changed
for this release. Do not prune Docker, remove shared volumes, or modify MongoDB.
For subsequent releases retain a previous immutable image tag and roll back to
it; this first launch has no previous Escowear production deployment.

## Validation limits

The isolated Nginx syntax checks use a temporary self-signed certificate, not a
real domain certificate. They do not establish DNS, ACME or public TLS readiness.
The frontend lockfile now fixes dependency versions and TypeScript 4.9.5
resolves the observed build failure. A successful image build is not a
dependency/security audit or a load test. Backend runtime uses the existing Node 20 base; runtime lifecycle and
dependency upgrades should be reviewed before launch.
