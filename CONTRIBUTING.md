# Contributing

## Issues and pull requests

Open an issue in [tote-hq/changuito-tasks](https://github.com/tote-hq/changuito-tasks) before starting work. Every pull request names that issue in the description:

```
Closes tote-hq/changuito-tasks#N
```

Name branches `type/short-description`, for example `fix/cart-link-tool-trail`.

Keep the pull request description basic: what changed, and the closing line above.

## Secrets

Never commit secrets, keys, or `.env` files. `.env.example` lists variable names only.

## Before you push

```bash
npm test -w @changuito/web
npm run typecheck -w @changuito/web
npm run build
gitleaks protect --staged
```

CI runs the unit tests and the web typecheck once per pull request, as a confirmation. Docs-only changes skip that run. The commands above are the real check.
