# @changuito/landing

Marketing landing for **www.changuito.me**, and the public stats dashboard at **/stats** (also the root of **stats.changuito.me**). It is a Next.js project separate from `apps/web` (the Stellar shopper, at app.changuito.me / ste.changuito.me).

It does not share routes with the shopper. During the controlled beta, the «Probar Changuito» buttons go to `/whitelist`. `APP_URL` (`https://app.changuito.me`) stays for SEO and docs, with no navigation from the landing.

## What the landing needs

The Worker is **`changuito-landing`**. It already serves `changuito.me`, `www.changuito.me` and `stats.changuito.me`. The deploy config is `cloudflare.config.ts`, `worker.ts` and `vite.config.ts`. Exact commands, and which names are build variables versus Worker secrets, are in [DEPLOY.md](../../DEPLOY.md) part 4. From the repo root, Node 22.18 or newer (`.nvmrc`):

```bash
npm run build:vinext -w @changuito/landing
npm run deploy:vinext -w @changuito/landing
npm run preview:vinext -w @changuito/landing   # http://127.0.0.1:3125 after the build
```

The site builds without variables. In production, `/whitelist` signs nobody up if Turnstile or a destination is missing. `/reportarbug` works with no variables (see below). `/stats` works with no variables: on-chain numbers come from public endpoints.

Production domains stay on `changuito-landing`. The Stellar shopper (`app.changuito.me` / `ste.changuito.me`) stays on the `apps/web` deployment. Do not point one at the other.

The waitlist lives at `/whitelist`. The next deploy picks up the route. With no destination configured, production answers that it could not sign the person up (it does not pretend the signup worked). In local `next dev` / `next start`, with no variables, the signup is appended to `apps/landing/.data/waitlist.jsonl` (gitignored).

### Variables the landing's deployment has to have

The `apps/web` deployment (`app.changuito.me`) does not share env with this one. Turnstile keys the shopper already uses have to be copied onto the landing's deployment. If either is missing, `/whitelist` answers 503: «No pudimos anotarte por un problema nuestro. Probá de nuevo en un rato.» Production does not skip the CAPTCHA.

On the landing's deployment:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `WAITLIST_WEBHOOK_URL`
- `WAITLIST_WEBHOOK_SECRET`

Analytics is optional and free. If these variables stay empty, the landing loads no gtag, Meta Pixel, or Clarity. Set them on the landing's deployment. Local can stay without them.

- `NEXT_PUBLIC_GA_MEASUREMENT_ID` (GA4, shape `G-XXXX`)
- `NEXT_PUBLIC_META_PIXEL_ID` (numeric)
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined into the client bundle: an empty value leaves the form with no widget. `TURNSTILE_SECRET_KEY`, `WAITLIST_WEBHOOK_URL` and `WAITLIST_WEBHOOK_SECRET` are server-only. On `changuito-landing` they are Secrets, not plain text variables and not entries in `cloudflare.config.ts`. The three analytics ids are public too, and when empty they load no scripts. An env change applies on the next deploy.

The live signup goes to Apps Script, so both webhook variables are required.

| Variable | Required | For |
|---|---|---|
| `WAITLIST_WEBHOOK_URL` | in production | `POST` JSON `{ kind, name, email, source, otherDetail, whatsapp, whatsappGroup, userAgent, createdAt }` and, if there is a secret, `webhookSecret`. HTTPS (Apps Script, Notion, Sheets, Slack, Make). `http` only on `localhost`. |
| `WAITLIST_WEBHOOK_SECRET` | together with the webhook in production | `Authorization: Bearer …` and the same value in the body as `webhookSecret`. Apps Script does not deliver `Authorization` or custom headers in `e.headers`; `doPost` has to read the secret from the body and must not store it on the sheet. An HTTP 200 with `{ "ok": false }` is a failure, not a signup. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | in production | Public Cloudflare Turnstile site key (the widget on the form). It has to be on this deployment, not only on the shopper's. |
| `TURNSTILE_SECRET_KEY` | in production | Turnstile secret key (server only; verifies the token before saving). Never commit it. If this or the site key is missing, production rejects the signup. |

The Apps Script (`appendWaitlist_`) is not in this repo. The `POST` sends this JSON (header `X-Changuito-Waitlist: 1`), with the names the script already reads:

| Field | Type | Notes |
|---|---|---|
| `kind` | string | Always `"waitlist"`. |
| `name` | string | Cleaned name. The script also accepts `nombre`. |
| `email` | string | Lowercased. |
| `source` | string | One option from the list (the stored Spanish value, for example `Por Fabio` or `Instagram`). The script also accepts `fuente`. English aliases such as `Through Fabio` are accepted and stored as the Spanish value. |
| `otherDetail` | string or `null` | Only when `source` is `Otros`. The script also accepts `detalle_otros`. |
| `whatsapp` | string | Required. E.164 with `+`. A local Argentine number is stored as `+549…` (the `15` is dropped and the `9` is added). |
| `whatsappGroup` | boolean | `true` if they want the beta-tester group. On the sheet it goes to `grupo_whatsapp`. |
| `userAgent` | string | Only if the request carries `User-Agent`. The script also accepts `user_agent`. |
| `createdAt` | string | ISO 8601. |
| `webhookSecret` | string | Only if `WAITLIST_WEBHOOK_SECRET` is set. It is auth, not a field about the person. The script reads it and does not write it on the row. |

`feedback` and `contactForFeedback` are not sent. The contact question was replaced by `whatsappGroup`.

### Cloudflare Turnstile

The `/whitelist` form sends a Turnstile token with the signup. The server checks it against `siteverify` before persisting. The honeypot (`company`) and the rate limit stay on; the CAPTCHA is additional.

- **Production:** if `NEXT_PUBLIC_TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` is missing on the landing's deployment, the signup is rejected (same spirit as an unconfigured sink). Verification is not skipped.
- **Local / non-production:** if the keys are unset, the submit is accepted with no widget (a warning is logged once) so `next dev` still works.

Create a widget in the [Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) (or reuse the one for `app.changuito.me` if the hostname `www.changuito.me` is allowed) and put both keys on the landing's deployment.

## Report a bug

`/reportarbug` is the public page for describing a failure (the app links `https://www.changuito.me/reportarbug`). The home footer points there too.

If `BUG_REPORT_WEBHOOK_URL` is set, the server `POST`s JSON. If it is not, the report is still accepted and lands in the process log with the prefix `[bug-report]`, so the page works before there is a destination. A webhook that answers badly is an error: the person can retry. An HTTP 200 with `{ "ok": false }` is also a failure.

| Variable | Required | For |
|---|---|---|
| `BUG_REPORT_WEBHOOK_URL` | no | `POST` JSON with `kind: "bug"`, the description in `error`, how to repeat it in `pasos`, `adjuntos` (photo or video in base64) and, if there is a secret, `webhookSecret`. `http` only on `localhost`. |
| `BUG_REPORT_WEBHOOK_SECRET` | no | If set, it goes as `Authorization: Bearer …` and the same value in the body as `webhookSecret`. Apps Script does not deliver `Authorization` or custom headers in `e.headers`; `doPost` has to read the secret from the body and must not store it on the sheet. An HTTP 200 with `{ "ok": false }` is a failure, not a saved report. |

That page's mascot is `public/brand/mascot-error.png` (the idle cart with X eyes and a downward gesture). It is not used in the hero or in the loading GIF.

The attachment is optional: up to 3 files, 3 MB total, JPG, PNG, WEBP, GIF, MP4, WEBM or MOV. The cap applies to the request body (base64 makes it larger) and to what Apps Script uploads to Drive. Each item is `{ name, mimeType, base64 }`. The script uploads them and writes the URLs in the `adjuntos` column.

If the dashboard does not detect the workspace and asks for commands by hand (the working directory is `apps/landing`):

```bash
npm ci --prefix ../..
npm run build -w @changuito/landing --prefix ../..
```

The lockfile is at the repo root. Security headers come from `next.config.ts`.

## Monorepo

From the repo root:

```bash
npm ci
npm run dev -w @changuito/landing      # http://localhost:3125
npm run build -w @changuito/landing
npm run typecheck -w @changuito/landing
```

The package is included by the root `package.json` workspace `apps/*`. It does not depend on `@changuito/mcp` or the bindings.

## Assets

The full kit lives in `apps/branding/` (manuals, logo, mascot, pattern, motion, social, copy, tokens). This app copies into `public/` only what the page serves:

| Public | Source |
|---|---|
| `public/brand/animacion-cargando.gif` | `apps/branding/motion/animacion-cargando.gif` (brand asset; the hero no longer uses it: that is a demo in code) |
| `public/brand/mascot-idle.png` | `apps/branding/mascot/mascota-idle.png` (reduced motion, `/whitelist` header, footer and close) |
| `public/brand/mascota-corriendo.png` | `apps/branding/mascot/mascota-corriendo.png` (CTA, in place of the arrow) |
| `public/brand/wordmark.png` | `apps/branding/logo/wordmark.png` (chunky lettering with the Sol de Mayo). Header of `/` (alone), `/whitelist` and `/reportarbug`. The same file is in `apps/web/public/brand`. |
| `public/og.jpg` | wide idle pose from the landing zip (1280×720, JPEG), Open Graph and Twitter. The previous file was named `og.png` but the bytes were JPEG, so the content-type did not match. |
| `public/brand/isotipo-mascota.png` | `apps/branding/logo/isotipo-mascota.png` (JSON-LD isotipo, not in the header) |
| `public/brand/mascot-error.png` | idle cart with X eyes and a downward gesture. Header of `/reportarbug`, next to the wordmark. |
| `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` | full idle mascot (`mascota-idle.png`) fitted in a square with a transparent margin (16/32/48, 32 and 180). No face crop. The same files are in `apps/web/app`. `/whitelist` inherits these icons (there is no `app/whitelist/icon.png`). |

The home header is the wordmark only. The footer and the close still use the idle mascot and the word «Changuito» in Inter. `/whitelist` shows the idle mascot and the wordmark. `/reportarbug` shows the error mascot and the wordmark. The background is flat `#FAFAF7`: the mate-pan pattern is not tiled.

## SEO

No environment variable is required. The HTML is `es-AR`. Next generates, at build time:

| Path | What it is |
|---|---|
| `/robots.txt` | allows indexing the marketing pages (including search and answer crawlers) and leaves `/api/` out |
| `/sitemap.xml` | `/`, `/whitelist`, `/reportarbug` |
| `/llms.txt` | a text summary, built from the public copy |
| `/manifest.webmanifest` | name, language and icons |

The shopper (`app.changuito.me`) has its own `robots.txt` and is not touched from here. `?estado=` on the list and on the bug report is not indexed; the canonical stays on the clean URL.

## Public stats (`/stats`, stats.changuito.me)

`worker.ts` serves this page at the root of `stats.changuito.me`. `/stats` is the same document on every host. The page renders on the request. The live read and `/stats/export` share one snapshot. That read has a 5.5s deadline: a source that does not answer is marked unavailable and the last published number stays. The last good snapshot is kept in the Cache API and on the edge (`s-maxage=300`, `stale-while-revalidate=600`), and a stale hit refreshes in the background.

- **No secrets needed:** Solana devnet escrow program `BFa1gZL9kVVo8Mq5gaDRM5RiCG4NDiyHLbpymfXvLz9d` (public RPC), Stellar testnet escrow from `deployments.json` (`CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S`) and mock USDC `CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E` (Stellar Expert events + Horizon), merged PRs (GitHub public search).
- **Optional Worker secrets, server-only:** `STATS_STELLAR_DATABASE_URL` and `STATS_SOLANA_DATABASE_URL` (read-only roles) for app accounts and delivered orders, and `STATS_GITHUB_TOKEN` for the GitHub search when the public rate limit is not enough. Set them on `changuito-landing` as Secrets. Do not commit them, and do not declare them in `cloudflare.config.ts`. The waitlist figure stays on the last published value.
- Any source that is missing, down, or still running when the 5.5s deadline fires keeps its last published value, and the page marks that source unavailable. In the All view, a single failed chain is marked partial and the live chain's numbers stay on the card. Only aggregates and public transaction hashes reach the browser. The Solana request path reads one signature page and a small set of transaction bodies; it does not scan the full history per hit.
