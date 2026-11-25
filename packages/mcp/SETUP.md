# Setup

Installing, configuring and operating `supermercado-mcp`: an MCP server that searches
Argentine supermarket catalogs and builds a cart inside **your own logged-in session**.

The server stops at `review_order`. It drives a headed browser as far as the payment
form and does not type a card, submit a payment, or move crypto.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Install and build](#2-install-and-build)
3. [Registering the MCP server in your client](#3-registering-the-mcp-server-in-your-client)
4. [TypeSafe / Jev API key (and running without it)](#4-typesafe--jev-api-key-and-running-without-it)
5. [Linking your Día account](#5-linking-your-día-account)
6. [Configuration reference](#6-configuration-reference)
7. [Running a dry run](#7-running-a-dry-run)
8. [Reviewing a cart](#8-reviewing-a-cart)
9. [Troubleshooting](#9-troubleshooting)
10. [Security model](#10-security-model)

---

## 1. Prerequisites

| | Why |
|---|---|
| **Node 20 or newer** | Native `fetch`, `node:test`, and top-level `await` in ES modules. Check with `node -v`. |
| **Chromium for Playwright** | The checkout is browser-driven. `npx playwright install chromium` (~150 MB). |
| **An MCP client** | Claude Code, Claude Desktop, or anything that speaks MCP over stdio. |
| **A Día account** | Created by you, in a browser, before anything here runs. DNI is required at signup, which is why this system never asks you for one — it reads it from your own profile. |

Only **Día** is implemented through checkout. Carrefour, Jumbo and Disco work for search and
price comparison and are refused by the checkout tools with a message saying so.

## 2. Install and build

```bash
cd packages/mcp
npm install
npx playwright install chromium
npm run build
```

Verify before configuring anything:

```bash
npm test
```

```bash
cp .env.example .env
```

Leave `.env` as-is for now. Search already works; the rest of this guide fills it in.

## 3. Registering the MCP server in your client

**Claude Code** — from the repository root:

```bash
claude mcp add supermercado -- node /absolute/path/to/packages/mcp/dist/index.js
```

**Claude Desktop** — in `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "supermercado": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/index.js"],
      "env": {
        "RETAILER": "dia",
        "SESSION_PASSPHRASE": "…"
      }
    }
  }
}
```

The passphrase goes in the client's `env` block rather than `.env`, because the server runs
over stdio with no terminal to prompt on and no guarantee that `.env` is loaded. See section
10 for what that means for where your secrets end up.

Restart the client, then ask it to run **`diagnose`**. It prints a one-step readiness
checklist (the store account), names the single next thing to do, and prints the resolved
configuration with no secret values in it. Run it again after every change.

Search and price comparison work before a session exists. The checkout tools are
`link_marketplace_account`, `set_delivery_address`, `build_cart` and `review_order`.
`review_order` is the last one: it drives the browser to the payment form and stops.
Nothing is typed into that form.

## 4. TypeSafe / Jev API key (and running without it)

Jev is **layer 3 of a four-layer classifier**, not the thing that drives the browser. It
cannot navigate, click or touch a DOM — Playwright does all the driving. Its job is answering
"what screen is this?" for the screens the deterministic layers don't recognise.

| Layer | | Needs a key |
|---|---|---|
| 1 | VTEX's own orderForm + URL hash — exact, free, unit-tested against saved JSON | no |
| 2 | Known-modal registry — cookie banner, address confirmation, slot picker, upsells | no |
| 3 | **Jev** — classifies the residual, with a confidence score | yes |
| 4 | Escalate to you — screenshot, page summary, "what should I do?" | no |

To enable it: create a key at `docs.typesafe.ai`, set `TYPESAFE_API_KEY` and `JEV_ENABLED=true`.

**Running without it is fully supported and is the default.** `JEV_ENABLED=false` runs layers
1, 2 and 4: strictly less capable — the loop asks you about screens it would otherwise have
classified — and never less safe.

Three rules hold when it is on:

1. **Fail closed.** Confidence below `JEV_MIN_CONFIDENCE` (0.75) or an unreachable API stops
   the run and escalates. It never guesses and never blind-retries.
2. **Never the authority on an amount.** Totals are read numerically from the orderForm and
   compared exactly.
3. **Never sees payment-field values.** The page extract is built from structure — URL,
   headings, button labels, field *labels*, error text, totals — never field values, and it
   goes through the redactor before leaving the process.

## 5. Linking your Día account

```
link_marketplace_account
```

A **headed** Chromium window opens on Día's login page and waits (default 5 minutes,
`timeout_minutes` to change it, up to 30). You log in yourself: email, password, whatever 2FA Día asks
for. When the session is live, the cookies are encrypted with `SESSION_PASSPHRASE` and saved
to `.secrets/dia.session.enc`, and the window closes.

**Your password is never read, never typed and never observed.** The login capture has no
`type` action, does not read input values and takes no screenshots. It waits for a logged-in
session to exist and then stores the cookies — which is all it needs.

Check and manage it:

```
session_status                        → is a session saved, and how old
session_status  check_live: true      → opens the store and confirms it still works
unlink_marketplace_account            → deletes the vault
```

Sessions expire. When one does, `session_status` says so and the checkout tools stop with a
message telling you to re-link rather than half-completing something.

## 6. Configuration reference

Every variable, what it does, and what happens if it's wrong. `diagnose` prints the resolved
values. Validation lives in `src/config.ts` and runs at startup: a bad value is an error
before anything happens, not a surprise in the middle of a run.

### Store

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `RETAILER` | `dia` | `dia`, `carrefour`, `jumbo`, `disco`. Unknown value → startup error naming the valid ones. Any value but `dia` → search works, checkout tools refuse. |

### Secrets

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `SECRETS_DIR` | `.secrets` | Session vault and escalation screenshots. Unwritable → the first save fails with the path. |
| `SESSION_PASSPHRASE` | — | Encrypts the session vault. Under 8 characters → refused. Wrong value → the vault won't decrypt; re-link. **Lost = re-link**, which costs one login. |

### FX

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `FX_BUFFER` | `0.15` | Buffer on the ARS/USD quote. Outside 0–1 → startup error. |
| `ARS_PER_USD` | *(looked up)* | Pins the rate, bypassing the network. Useful for dry runs and tests. Outside 50–100000 → startup error. |

### Jev

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `JEV_ENABLED` | on if `TYPESAFE_API_KEY` is set | On without a key → startup error. Off → layers 1, 2 and 4 only. |
| `TYPESAFE_API_KEY` | — | Classifier only. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai/v1/systemone` | Override for a mock. |
| `JEV_MIN_CONFIDENCE` | `0.75` | Below this the loop escalates instead of acting. |

### Browser

| Variable | Default | What it does / if it's wrong |
|---|---|---|
| `HEADLESS` | `true` | Checkout visibility. The login capture is always headed regardless. |
| `MAX_STEPS` | `25` | Hard ceiling on loop iterations, so a confused page can't spin forever. Too low → a legitimate flow escalates. |
| `MAX_MINUTES` | `4` | Wall-clock ceiling on the same loop. 0.5–30. |
| `SLOWMO_MS` | `0` | Delay between actions. Useful with `HEADLESS=false` when watching a run. |

### Smoke test

| Variable | Default | |
|---|---|---|
| `SMOKE_QUERY` | `leche descremada` | Search term for the read-only four-store regression. |
| `SMOKE_POSTAL_CODE` | `1425` | Postal code it prices against. |

## 7. Running a dry run

The dry run searches, opens your real session, writes to your real cart and drives the real
checkout to the payment form. It does not type into that form and it does not submit a
payment.

```bash
# Config and FX only — touches nothing of yours
npm run dryrun -- --no-browser

# The full rehearsal
npm run dryrun -- --cp 1425 --search "leche descremada" \
                  --street "Av. Corrientes" --number 1234

# Review whatever is already in your cart, without adding
npm run dryrun -- --skip-cart
```

Useful flags: `--sku id:qty` (repeatable, instead of searching), `--qty`, `--clear-first`,
`--complement`, `--city`, `--province`, `--phone`, `--postal-code`, `--minutes`.

**One thing here is genuinely destructive: it writes to your real cart**, and it says so out
loud when it does. Use `--skip-cart` if you'd rather it didn't.

A clean run ends with `Payments submitted: 0` and exits 0. Any problem exits non-zero with
the specifics.

**Recording a checkout.** The first time, and whenever Día changes its flow, record a real
one so the deterministic layers are built against screens that exist:

```bash
npm run record          # headed; you drive; stop AT the payment form
```

It polls every second and captures a fixture whenever the page becomes a different page. On
exit it names the screens the deterministic layers did *not* recognise — those are the ones
worth turning into a `modals.ts` entry. Output lands in `fixtures/recordings/<timestamp>/`
relative to `packages/mcp/`, and **the orderForm is scrubbed before it touches disk**: name,
email, DNI, phone and street are replaced with same-shaped placeholders, so a fixture is a
description of a screen rather than a copy of your identity.

Do not place an order to record one. Stop at the payment form.

## 8. Reviewing a cart

In conversation:

```
search_products       "leche descremada"          → pick what you want
link_marketplace_account                          → you log in (once)
set_delivery_address  street, number, postal_code, …
build_cart                                        → items land in YOUR real cart
review_order                                      → itemized total + a link to open it
```

`review_order` drives the checkout to the payment form and stops. You finish the payment
yourself, in Día, from the cart link. The server does not ask for a card number and does not
confirm a payment.

**You are asked for your address.** Name and DNI are read from your own Día profile — never
asked for.

## 9. Troubleshooting

**Start with `diagnose`.** It prints the resolved configuration with no secret values in it,
and separates a configuration problem from a store problem in one step.

| Symptom | What's happening | Fix |
|---|---|---|
| "No saved session" / everything checkout-ish refuses | No vault, or `SESSION_PASSPHRASE` doesn't match the one that wrote it | `link_marketplace_account`. If it was a passphrase change, `unlink_marketplace_account` first. |
| Session expired mid-run | Día invalidated the cookies | `session_status check_live: true` confirms it; re-link. Your cart survives — it lives at the store. |
| Out of stock mid-checkout | The store changed the cart under you | `review_order` re-reads and shows the new total. |
| "the loop stopped to ask a question" | An unrecognised screen — layer 4 doing its job | Read the summary and screenshot (under `$SECRETS_DIR/screenshots`). If it recurs, `npm run record` it and add a `modals.ts` entry. |
| Stalls, then escalates | Three non-advancing iterations | Usually a modal the registry doesn't know. Same fix: record it. |
| Playwright can't launch | Chromium not installed | `npx playwright install chromium`. |
| Tests fail after an edit | — | `npm run build` first; the suite runs against `dist/`. |

Running with `HEADLESS=false SLOWMO_MS=250` is the single most useful diagnostic for anything
browser-shaped. You watch it happen.

## 10. Security model

### What is stored, where, and under what

| | Where | Protected by |
|---|---|---|
| **Your Día password** | **Nowhere.** You type it into a headed browser. | Never read, never typed, never observed |
| Session cookies | `.secrets/dia.session.enc` | AES-256-GCM under a scrypt-derived key from `SESSION_PASSPHRASE` |
| `TYPESAFE_API_KEY` | `.env` or your MCP client's config | Filesystem permissions |
| Your name, DNI, address | Read from your Día profile at run time | Not persisted by this system |

### The redactor

`secure/redact.ts` wraps every log line and every MCP response, masking 13–19 digit runs
(PANs), bearer tokens, CVV-shaped values near card fields, DNI numbers and cookie values.
It is unit-tested.

### The tracing kill-switch

Playwright tracing, video and screenshots are **hard-disabled** during the payment step, so
a trace cannot capture a number the shopper types after this server has stopped.

### If something leaks

| | Do this |
|---|---|
| Session vault copied | `unlink_marketplace_account`, then change your Día password — that invalidates the stolen cookies. |
| `SESSION_PASSPHRASE` leaked | Same. The vault is only as good as the passphrase. |

**Passphrases in an MCP client's config sit on disk in plaintext.** The server runs over
stdio with no terminal to prompt on, so they come from the environment. Encrypting the vault
protects it from *file copying*, not from someone who already has your client's
configuration. Filesystem permissions on that file are load-bearing.

**Día's `robots.txt` disallows `/checkout/*`.** That governs crawlers, not a person driving
their own logged-in session through their own browser — but it is your account and your call.
