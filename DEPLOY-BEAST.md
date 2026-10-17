# Escowear on Beast (pre-deployment checklist)

This branch prepares a Docker image and Compose service. It does **not** configure Beast's reverse proxy, DNS, TLS certificates, or production credentials.

## Requirements

- Confirm the registered Beast workspace and deployment conventions before pulling.
- Docker Engine and Compose plugin available on Beast.
- A private MongoDB connection URI for database `escowear-sneaker-import-test` accessible from Beast. **This repository currently requires that exact database name**, even in production. Review whether using the test database for public traffic is acceptable before launch.
- A strong `JWT_SECRET` value. Never commit secrets.
- Confirm `127.0.0.1:5080` is free and the reverse proxy will target that port.

## Build and local-only smoke test on Beast

```bash
git fetch origin
git switch ide-112-docker-beast
git pull --ff-only origin ide-112-docker-beast
# Create a private .env in this workspace, never commit it.
# Required: ESCOWEAR_MONGO_URI, JWT_SECRET
chmod 600 .env
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
curl -fsSI http://127.0.0.1:5080/
```

Do not run the final `docker compose up -d` until the production deployment is explicitly approved and existing services/ports have been checked.

## Public launch (separate approval required)

Use Beast's existing reverse-proxy/TLS deployment pattern for `escowear.com`, redirect `www.escowear.com` to the apex domain, and change Namecheap DNS only after verifying the VPS address and obtaining approval. Do not expose the container port publicly. Verify the homepage, product API, images, authentication and order flows before announcing launch.

Rollback should use the previously verified image/commit and proxy configuration; keep database backups before public launch.
