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
- **Checkout.** One test, the whole flow: a scripted turn draws a basket, the
  importe is quoted with its código and confirmed on the second poll, the
  fixture store renders inside the frame, a single-use card is issued and its
  3DS code counts down, **Ya lo pagué** is corroborated before the receipt is
  written, and the card is given back in the same breath. Then: the chat is
  read-only, a second order in it is refused, and the receipt survives a
  reload and reopens from the history rail. Two assertions are guardrails
  rather than features — that the PAN, the CVV and the one-time code never
  reach `localStorage` or `sessionStorage`, and that traces, video and
  screenshots are off, because this repo is public and those numbers are on
  screen for most of the run.
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

## GitHub Actions

Actions runs `.github/workflows/unit.yml` on every pull request and on every
push to `main`. That job is `npm test` only. Playwright is not a workflow in
this repo: run it locally with `npm run test:e2e`.

Never commit `e2e/.env` or a real inbox.
