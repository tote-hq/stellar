# End-to-end

Playwright. Unit tests stay on `npm test` and do not open a browser.

| Project | Target |
|---|---|
| `landing` | `LANDING_BASE_URL`, default `https://www.changuito.me` |
| `app` | `APP_BASE_URL`, default `https://app.changuito.me` |
| `compare` | `APP_BASE_URL`. Opt-in. `npm run test:e2e:compare` |

The first two are smokes, and production is their target on purpose. A local
preview needs Pollar, Turnstile, and the model keys the app already has on
the Worker; CI does not have those, and a preview would not be what visitors hit.
Neither smoke pays, opens a store checkout, or clicks **Cargar USDC**.

**What a smoke does not prove:** that a purchase happened. There is no sandbox
supermarket — Día has no test store — so past "Ya lo pagué" it asserts what the
app does when the store *says* paid, and nothing about Día. The deposit leg has
been run for real against testnet Horizon by hand.

## Run locally

Node is `22.12.0` (`.nvmrc`). From the repo root, after `npm ci`:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:e2e:ui
```

`test:e2e:ui` opens Playwright's runner. Optional overrides live in
`e2e/.env` (copy `e2e/.env.example`). Values already exported in the shell
win over that file.

## What the specs assert

- **Landing.** The home page renders, the three nav anchors (`#como-funciona`,
  `#pagos`, `#faq`) scroll into view, **Probar Changuito** and **Sumate a la beta**
  go to `/whitelist`, and one FAQ item expands.
- **Whitelist.** An empty submit shows the name and email errors. A name plus
  `no-es-un-email` shows `Revisá tu email.` The test does not submit a real
  signup.
- **App, guest.** The masthead and **Empezá a comprar** render, and the page
  throws no uncaught error. **Empezá a comprar** opens the Pollar modal
  (`Ingresá o creá tu cuenta`, email, Continuar, Google, Wallet) and there is
  no password field. The matchers also accept Pollar's English originals, for
  a run that lands before a deploy is live (`e2e/support/pollar-copy.ts`). The spec closes the modal and does not submit. Chat is
  behind Turnstile. If the check passes, the spec clicks the
  leche-con-proteína chip (or types a short prompt), waits for the reply that
  asks for the postal code, and stops. If Turnstile
  stays up, the verification screen is the pass: CI must not depend on
  Cloudflare letting a bot through. A headless run on 2026-09-24 stayed on
  that screen. Product search is not asserted: a search can take a minute.
  The postal-code reply is, because a guest stuck before it was the blocker
  in issue [#51](https://github.com/raptor0929/changuito/issues/51); the
  server now answers it without a model hop.
- **Checkout.** Project `checkout`, against `next dev`, not a deployment.
  The virtual-card path is gone. The spec seeds one basket, mocks quote /
  lock / status as `demo`, and asserts the dialog stops at "Llegamos hasta
  el pago" with a test-mode receipt. A second test opens `/dev/checkout` and
  checks the fixture says it is not the supermarket. Traces, video, and
  screenshots are off.
- **App, auth.** Skipped unless both `CHANGUTO_E2E_EMAIL` and
  `CHANGUTO_E2E_PASSWORD` are non-empty. It opens **Empezá a comprar** and
  uses the email field. Traces and screenshots are off for this spec so a
  public Actions artifact cannot keep the inbox or the code.

## Pollar has no password field

`@pollar/react` 0.11.3 (what the shopper mounts) signs in with email by
sending a **6-digit code**, then Google or a wallet. Pollar's own copy is
English (`Log in or sign up`, `Submit`, `or continue with`); the shopper
rewrites it to Spanish after render (`Ingresá o creá tu cuenta`, `Continuar`,
`o seguí con`). There is no password input.

So:

| Secrets | What the auth spec does |
|---|---|
| Either missing or blank | Skips |
| Email + any password, no 6-digit code | Submits the email, expects the code screen, does not claim the wallet chrome |
| Email + `CHANGUTO_E2E_OTP` (or a password that is exactly 6 digits) | Types the code and expects **Salir** and **Tu pago**. **Cargar USDC** is expected only if `GET /api/faucet` says this wallet is granted in the database; otherwise the spec checks the button is absent |

A normal password cannot finish login. A code is one-time, so a standing
GitHub secret will not keep the signed-in assertion green unless Pollar
issues a fixed test code. Google OAuth is intentionally not automated.

If the modal has no email field, the spec skips and records that the widget
was Google or wallet only.

## Día vs Coto card

`npm run test:e2e:compare` runs project `compare` with `COMPARE_E2E=1`.
Without that variable the spec skips, so `npm run test:e2e` stays the
production smoke. The target is the Worker at `APP_BASE_URL`.

The spec does not shop, does not call the model, and does not flip
`chat_dual_compare`, `sandbox_mock`, `sandbox_mock_fail`, or
`turnstile_disabled`. It writes one stored chat into `localStorage` (the
transcript the shopper already keeps) and opens it from the history rail.
`GET /api/human` is answered as `{ "mode": "open" }` inside the test only,
so the human gate does not hide the card. Checkout routes are not stubbed.

It asserts the card at `data-testid=compare-card`: the Spanish match line
(`2 de 3 productos coinciden` for the fixture), no `20%` and no fee words
on that card, a Día link whose href is the cart handoff, and a Coto link
on `https://www.coto.com.ar/`. After each click, no request goes to
`/api/checkout/quote`, `/api/checkout/start`, `/api/checkout/open`, or
`/api/checkout/channels`.

Screenshot, video, and trace are on for this project. They land in
`test-results/` and `playwright-report/`, which are gitignored. Do not
commit them.

## Dual mock checkout

`npm run test:e2e:dual-checkout` runs project `dual-checkout` with
`DUAL_CHECKOUT_E2E=1`. Without that variable the spec skips. It seeds one
stored chat, stubs `GET /api/human`, and does not flip config rows or call
the model. It checks both pay cards (heading, accessible name, and a 44px
target at 390 and 1440), no `checkout-compare`, no `20%`, no `rail-pay`,
that the Coto quote body sends `payRetailer: "coto"` and no amount, and that
starting one pay disables the other. Settlement basis stays a unit test.
Screenshot and video are on. Do not commit `test-results/`.

## GitHub Actions

`.github/workflows/unit.yml` runs `npm test` and the web typecheck on every
pull request. Docs-only changes skip that job. It does not run on push to
`main`.

`.github/workflows/e2e-weekly.yml` runs Monday at 05:00 in
America/Argentina/Buenos_Aires (`0 8 * * 1` UTC), and on `workflow_dispatch`.
It has three parts:

- Soroban `cargo test` for `contracts/`.
- Project `checkout`: a local `next dev` on port 3124, Cloudflare's published
  Turnstile dummy keys, and route mocks. It does not call the model, the
  database, or mainnet. Traces, video, and screenshots are off.
- Project `shell`: a read-only look at the public shopper. It does not send
  a chat message. `landing` is not in this workflow. Cloudflare's interactive
  challenge blocks the GitHub runner on www.changuito.me, so a weekly landing
  smoke cannot see the page. `e2e/landing.spec.ts` stays in the repo and still
  runs when you ask for that project locally.

`@quarantine` tests are excluded (`grepInvert` in `playwright.config.ts` and
`--grep-invert` in the workflow). HTML and JUnit land as artifacts for 7 days.

`npm run test:e2e` locally still runs the projects you name. A run with no
`--project` also starts the checkout dev server, because that suite is part
of the full set.

Never commit `e2e/.env` or a real inbox.
