---
name: admin-dashboard
description: How to test changuito's operator desk on admin.changuito.me — the notifications desk, the /orders/:id viewer page, and «Abrir la pantalla». Also says where the charging card is read and where a Coto order is placed. Use before changing apps/web/lib/admin, apps/web/app/admin-portal, or apps/web/app/api/admin.
---

# Testing the admin dashboard

Never write a password, admin user, cookie, database URL, `SANDBOX_URL`,
`SANDBOX_TOKEN` or any card column (pan, cvv, exp, holder) into an issue, a
PR, a commit, a test, or a log. If credentials are passed to you out of band,
use them only to sign in and look. Never select the card columns.

## Routes on the admin host

`decideAdmin` in `apps/web/lib/admin/gate.ts` decides every request whose host
is `admin.changuito.me` (or `admin.localhost` outside production).

| Request | Signed out | Signed in |
|---|---|---|
| `GET /`, `GET /orders`, `GET /orders/` | 401 login page | rewrite to `/admin-portal` (the desk) |
| `GET /orders/:id` | 401 login page | rewrite to `/admin-portal/orders/:id` (the viewer page) |
| `POST /api/admin/login` | open | open |
| `/api/admin/*` | 401, empty body | passes to the route |
| `/admin-portal` typed directly | 404, empty body | 404, empty body |
| anything else | 404, empty body | 404, empty body |

On the shopper host (`app.changuito.me`), `/api/admin/*` and `/admin-portal*`
are an empty 404. Keep that. The pages are only reachable through the rewrite.

An empty 404 is what Chrome shows as «This page can't be found». If an operator
sees that, the path did not match a row above.

## The desk

`apps/web/app/admin-portal/page.tsx`. It polls `/api/admin/session` (for the
CSRF token) and `/api/admin/notifications` every 3 seconds. A note with an
order id links to `/orders/:id`. A note without one (for example
`missing_card`, stored with a null order id) is plain text, not a link.
«Listo» posts `/api/admin/notifications/:id/read` with `x-csrf-token`.

## The viewer page and «Abrir la pantalla»

`apps/web/app/admin-portal/orders/[id]/page.tsx`. «Enviar pregunta» posts
`/api/admin/orders/:id/prompt` (409 means a question is already pending).
«Abrir la pantalla» calls `GET /api/admin/orders/:id/viewer` and opens the
returned `url` in a new tab. The url is null outside the signing window, and
the page says the screen only opens within 60 seconds of the signature.

## Where the card is read, and where the order is placed

- **Worker `changuito-web`** (Cloudflare) quotes the Coto basket. Before the
  lock it checks `sharedCardPresent()` in `apps/web/lib/checkout/coto-admit.ts`:
  `select 1 from shared_card where network = DEFAULT_NETWORK`. No row, no
  database, or a failed read all return false. The quote then answers 409
  with `MISSING_CARD_COPY` («Falta una tarjeta en la cuenta…») and the desk
  gets a `missing_card` note. That is config, not code: the fix is an
  operator adding the row, never a diff.
- **Sandbox** (Railway project `joyful-nature`, service `solana`) places the
  Coto order. The Worker posts the job to it at `SANDBOX_URL`
  (`apps/web/lib/checkout/sandbox.ts`), and the sandbox types the
  `shared_card` row into Coto's checkout. The viewer url comes from there too.

There is no `COTO_REAL_LIVE` variable. `COTO_REAL_ENABLED=1` plus admission
decides whether a shopper sees Pay at all.

## Checks

- `apps/web/lib/test/admin-gate.test.ts` pins the table above.
- By hand, signed in: `/orders` shows «Pedidos»; `/orders/<id>` shows
  «Pedido», the id, and «Abrir la pantalla». Signed out, both show the login.
- A count of `shared_card` rows is the only database fact you may report.
