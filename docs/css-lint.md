# CSS compatibility lint

Escowear runs [Stylelint](https://stylelint.io/) before deployment.

Run locally:

```bash
npm run lint:css --prefix client
```

`npm run lint --prefix client` runs both JavaScript ESLint and CSS Stylelint. The existing Docker `frontend-test` stage runs `npm run lint`, so a CSS lint failure stops `npm run deploy` **before** replacing the production container. GitHub Actions checks CSS on pull requests too.

The project rule rejects the unprefixed CSS alignment value `end` for `align-*/justify-*/place-*` alignment properties; use `flex-end` for flex layouts. Grid `start` is left unchanged. This prevents the Autoprefixer warning that previously blocked Escowear's `CI=true` frontend build.

Stylelint CLI is pinned to version 17.16.0 via `npm exec`, so no existing application lockfile is modified. The command requires npm registry access on a fresh machine. Regular JavaScript/React dependencies continue to use `npm ci`.

No Docker, MongoDB, Nginx, checkout, or production configuration changes are part of this linting change.
