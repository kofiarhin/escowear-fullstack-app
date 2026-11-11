# Standalone Docker Compose deployment

This feature does not deploy automatically from GitHub. After merging to master and pulling onto Beast, run inside the existing Escowear checkout:

```bash
npm run deploy:check
npm run deploy
```

Running `npm run deploy` is the operator's authorization to change the production Escowear container. There is no additional approval prompt. It fast-forwards the configured Git branch, runs the Docker frontend lint/tests and backend tests, builds a commit-tagged image, saves the running image for rollback, replaces **only** the configured Compose service, and checks the container plus local/public health endpoints. On a failed deploy/health check it attempts to restore the previous image.

Use `npm run deploy:rollback` to manually restore the most recently saved previous image. The script keeps 3 release image tags plus the last rollback image, and removes only project-labelled stopped service containers and older project-specific image tags after a successful deployment. It never runs `docker system prune`, deletes volumes, edits Nginx, modifies MongoDB, or changes public ports.

Configure another project by copying `scripts/deploy.sh`, editing `scripts/deploy.conf`, and supplying an appropriate Dockerfile test target, Compose health check, and backend test command. The included checkout-release guard is specific to Escowear and must be adapted for other apps.

Local state is kept in ignored `.deploy-state/`. Existing deployments are adopted by their actual live container image ID; scripts do **not** assume the initial October image tag is still running. `--check` is read-only except for creating the ignored lock directory. A clean `master` checkout, Docker access, and private mode-600 `.env` are required.

**Limits:** Deployments use a single container, so expect a short interruption. Image rollback does **not** reverse database changes, emails, payments, or changes to environment/Compose settings. Run the first deployment only after checking actual VPS disk space, active service configuration, and backup readiness. Checkout/publication must not be enabled until the existing release checklist permits it.
