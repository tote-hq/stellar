# Deploying changuito

Two halves, in this order: the contracts on Stellar testnet, then the app on
Cloudflare Workers. The contracts are already deployed and their ids are committed in
`deployments.json`, so **if you are only deploying the app, skip to part 2.**

---

## Part 1 — the contracts

You need this if you changed anything under `contracts/`, or if testnet has
been reset since the ids in `deployments.json` were recorded.

### 1.1 Install the toolchain

```bash
rustup target add wasm32v1-none
brew install stellar-cli          # or: cargo install --locked stellar-cli
stellar --version
```

Built and verified with CLI 25.1.0 against a protocol-28 ledger. A newer CLI is
fine; if yours is much older, upgrade rather than pinning `soroban-sdk` down to
meet it.

### 1.2 Point the CLI at testnet

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### 1.3 Run the deploy script

```bash
npm run deploy:testnet
```

That one command does all of it:

1. Creates the two identities if they are missing — `changuito-resolver` (the
   token admin *and* the escrow resolver: one hot key, because a demo with two
   is two keys to leak) and `changuito-treasury` (an address only; nothing ever
   signs for it) — and tops both up from friendbot.
2. Builds both contracts for `wasm32v1-none`.
3. Deploys `mock_usdc` with the resolver as admin, then `escrow` with the
   resolver, the treasury and the token id as constructor arguments.
4. Writes `deployments.json`, and generates `apps/web/lib/deployments.ts` from
   it.
5. Generates TypeScript bindings into `packages/escrow-bindings` and
   `packages/usdc-bindings`, then rewrites each one's `package.json` to be a
   workspace package that shares the app's exact `@stellar/stellar-sdk`
   version. That last part matters: two copies of the SDK in one process means
   two sets of XDR classes, and `instanceof` quietly stops working.
6. Verifies the result with live `config`, `symbol` and `decimals` calls.

It is idempotent. A contract already recorded is left alone, so re-running
after a failure halfway through resumes instead of stranding the first
contract. To force new ids:

```bash
npm run deploy:testnet -- --force
```

#### Live testnet escrow (mintable `mock_usdc`)

The Circle USDC SAC path is withdrawn. Run without `USDC_ISSUER` so the script
deploys a new `mock_usdc` (resolver as admin) and an escrow over that token.
The live ids:

| | |
|---|---|
| escrow | `CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S` |
| mintable token | `CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E` |
| classic deposit issuer | `GCGV3225QTJFJ32KTPJNOR5SYANP4QWNUGKKGKVK7ILMK4QACZHJTGJB` (memo rail only; not the escrow token) |

The previous deploy `CCA3ES6ANWAAJXB436XTSPGFRGX5GDZLHC7UOF25K4B5OFDJML4JG7EX` is retired.

```bash
npm run deploy:testnet
```

Two accounts need to exist and hold XLM before it runs, and a person funds them:
`changuito-resolver` and `changuito-treasury` in `stellar keys ls`.
The only identity for the resolver is `changuito-resolver`
(`GBXBAOFWG4Y4ZQEDXH73BACYYCE7ODSKXHLXYVRPLJOYFRDCPWHGYGN5`). Do not redeploy
with another resolver. A person sets `STELLAR_RESOLVER_SECRET` to that identity
so it matches `deployments.json`. The treasury
(`GBKJHIKIZONKCCV2JVOGUDXEOPTQUZ2OKYZNV3R3LDALNZHCSF2JJEIF`) stays. The escrow
token is Soroban-only, so the treasury needs no classic USDC trustline for
`settle`.

`USDC_ISSUER=…` still exists in the script for a SAC deploy, but that is not the
live escrow and must not be used for this redeploy.

### 1.4 Commit what changed

```bash
git add deployments.json apps/web/lib/deployments.ts packages/*-bindings
npm test          # the suite checks the bindings and deployments.json agree
```

### 1.5 Put the resolver secret where the app can read it

```bash
stellar keys show changuito-resolver     # prints S…
```

Paste it into `apps/web/.env.local` as `STELLAR_RESOLVER_SECRET`. That file is
gitignored. The app refuses a key whose public address does not match the
resolver the contracts were deployed with, so a stale one fails loudly rather
than at the first mint.

### 1.6 Issue the testnet USDC preview pays with

Run once per testnet reset, and only if `contracts.usdc.issuer` is `null` for
testnet in `deployments.json`.

```bash
node scripts/setup-demo-asset.mjs --demo <identity> --deposit <identity>
```

Both arguments are `stellar keys ls` identity names: the demo wallet that
preview pays *from*, and the account `DEPOSIT_ADDRESS_TESTNET` names, which it
pays *to*. The script checks the second really is that address before it signs
anything, and refuses outright if testnet already has a classic issuer.

**Why this exists rather than reusing `mock_usdc`.** The Soroban token
(`contracts.usdc.id`) is a pure SEP-41 contract: balances live in contract
storage and transfers are contract events, so there is no classic payment
record with a memo field for the deposit rail to read. Minting billions of it
to the demo wallet would fund a balance the rail cannot see — which is why
`depositAssetFor` treats a falsy issuer as native XLM, and why preview paid in
lumens until this ran. A classic asset means preview rehearses the mainnet path
exactly: trustline, asset code, issuer, memo. With play money.

What the script does, in order: friendbots the demo wallet and the deposit
account if either has no ledger entry yet; generates and funds a fresh issuer;
adds a `USDC:<issuer>` trustline from both sides of the rail, because a classic
asset cannot reach an account that has not trusted it; pays **1,000,000,000
USDC** to the demo wallet; then sets the issuer's master weight to `0` and
deletes the identity. That last step is the point — it
locks the account, so no further issuance is possible by anyone including us,
and "a billion is the supply" becomes a property of the ledger rather than a
promise in a comment. **No secret passes through the process**: every signature
is made by the `stellar` CLI from a local identity.

Then record the issuer and regenerate — do not hand-edit the generated module,
it carries a do-not-edit header:

```bash
# set contracts.usdc.issuer for testnet in deployments.json to the printed G…
node scripts/write-deployments-module.mjs
node scripts/check-deposit-account.mjs testnet   # trustline present, asset matches
git add deployments.json apps/web/lib/deployments.ts
npm test
```

`contracts.usdc.id` stays as it is. The Soroban token still backs the dormant
escrow; it is simply no longer on the deposit rail.

---

## Part 2 — the app on Cloudflare Workers

The app is the Worker **`changuito-web`**, which owns `app.changuito.me`.
It is deployed by **Workers Builds** from this repository's `main` branch,
not from a laptop. Which variables exist, and what each name means, is under
[Variables and services](#variables-and-services) below.

The build is vinext on Vite (`apps/web/vite.config.ts`, `worker.ts`,
`cloudflare.config.ts`). It needs **Node 22.18 or newer**, because the config
loader refuses anything older; `.nvmrc` pins it, and Workers Builds reads
that file. `next build` keeps working for local checks.

### Workers Builds settings (`changuito-web` → Settings → Build)

| Setting | Value |
|---|---|
| Git repository / branch | `tote-hq/stellar`, `main` |
| Root directory | `/` (the repository root: the build is an npm workspace) |
| Build command | `npm run build:vinext -w @changuito/web` |
| Deploy command | `npm run deploy:vinext -w @changuito/web` |
| Builds for non-production branches | off |
| API token | the one Workers Builds creates. The deploy reads it from `CLOUDFLARE_API_TOKEN`, so nothing logs in interactively |

The build command compiles `packages/mcp` and runs the Vite build. It does
not read `DIRECT_URL` and it applies no SQL. A person runs `npm run db:migrate`
on a machine that has that URL when the schema should change; that command is
the approval, including for a migration that drops or rewrites something. The
deploy command uploads the build (`--skip-build`), so run it only after the
build command.

**Build variables and secrets.** `NEXT_PUBLIC_*` is inlined into the bundle
at build time, so it is set here, not under the Worker's runtime variables:

| Name | Kind | Value |
|---|---|---|
| `NEXT_PUBLIC_POLLAR_API_KEY` | variable | the **testnet** Pollar publishable key |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | variable | the Turnstile site key for `app.changuito.me` |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_CLARITY_PROJECT_ID` | variable | optional |

`CHG_HYPERDRIVE_ID` and `DIRECT_URL` are not build settings. Without the
Hyperdrive id the Worker deploys with no database binding and the app runs
the way a fresh clone does. `DIRECT_URL` stays on the laptop that runs
`npm run db:migrate`.

**Contract ids are runtime variables, not build variables.** Set them on
`changuito-web` → Settings → Variables and Secrets, as variables of the
running Worker. The browser asks `/api/contracts` on each checkout, and the
server reads the value for that request. Changing one does not take a new
build. Unset, the request uses the id recorded in `deployments.json`.

| Name | Network |
|---|---|
| `STELLAR_ESCROW_ID` | testnet escrow |
| `STELLAR_USDC_ID` | testnet token |
| `STELLAR_ESCROW_ID_MAINNET` | mainnet escrow |
| `STELLAR_USDC_ID_MAINNET` | mainnet token |

A value that is not a `C…` contract id is ignored. Do not put these names in
the build variables: the build does not read them, and a value inlined there
would not be the one a later request sees.

Never set `NEXT_PUBLIC_POLLAR_API_KEY_MAINNET` there: whatever it holds is
inlined. On a local machine the same public names can come from the shell.

**Worker secrets** (`changuito-web` → Settings → Variables and Secrets, type
*Secret*). Same names and meanings as the tables in
[2.4](#24-environment-variables): `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY`,
`CHG_SESSION_SECRET`, and for payments `STELLAR_RESOLVER_SECRET`,
`DEPOSIT_ADDRESS_TESTNET`, `DEMO_WALLET_SECRET`, plus optionally
`FX_ARS_PER_USD`. Without the
three payment ones the app runs and checkout answers 503 "los pagos no están
habilitados" (`lib/test/go-live-without-payments.test.ts`).

`OZ_CHANNELS_API_KEY` is the OpenZeppelin Channels key for testnet, from
[channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen).
Channels pays the fee for the escrow `open`, so the buyer signs only an
authorization entry and spends no XLM. Set it here as a *Secret*, never as a
build variable and never in `cloudflare.config.ts`: a value there is
committed, and declaring a binding the dashboard does not have yet makes the
strict deploy abort. The hosted service caps the fees one key may spend and
resets that cap every 24 hours; past it, a request fails with
`FEE_LIMIT_EXCEEDED`.

The faucet list is the database, not a Worker secret. Apply
`supabase/migrations/0011_wallet.sql` first. `config.faucet_open_to_all`
(default false) lets any wallet that is not banned mint; otherwise only a
`wallet` row with `faucet_allowed` does.
`node scripts/config.mjs set faucet_open_to_all true` flips the flag, and
`npm run wallet -- allow G...` grants one address. A `banned` row refuses
the login cookie and the faucet. With no database the faucet is closed.
The SEP-53 proof is still required.

No Redis. The chat and faucet quotas count in Postgres (`quota` table,
`lib/kv.ts`). Production without `DATABASE_URL` refuses them. `KV_REST_API_URL`
/ `KV_REST_API_TOKEN` are still read by `lib/agent/turn-store.ts` alone, and
are optional. Without them a conversation's history lives in the isolate's
memory: it survives while the same isolate serves the shopper, and is lost on
a cold start or a deploy. Moving the turn store to the `kv` table is a
separate change.

`NODE_ENV=production` is set by `cloudflare.config.ts` itself. It is not
optional: the app reads it at runtime, and on a Worker `process.env` holds
only the bindings, so without it every fail-closed rule takes its
development branch.

`DATABASE_URL` is not a secret here. `worker.ts` copies the Hyperdrive
binding's connection string onto it for each request.

---

### Variables and services

### 2.1 Get the two API keys

- **Anthropic** — [console.anthropic.com](https://console.anthropic.com) → API
  keys. This is what runs the shopping agent.
- **Pollar** — the [Pollar dashboard](https://pollar.xyz) → your application →
  API key, with the network set to **testnet**. This one is publishable and
  ships in the browser bundle by design.

Testnet, while D1 runs. A Pollar dashboard key is network-scoped — the key is
the network, and the login network in `lib/pollar.ts` follows whichever key is
set rather than a variable of its own. In the dashboard, on that testnet app:

| Setting | Value |
|---|---|
| Network | **testnet** |
| Allowed domains | `app.changuito.me`, `ste.changuito.me`, and the Stellar Worker `*.workers.dev` URL |
| Login methods | Freighter enabled, plus the existing email and Google |
| Fee sponsorship | **off** — OZ Channels pays fees |
| Reserve sponsorship | **off** — Changuito's sponsor account pays reserves |

The mainnet key (`NEXT_PUBLIC_POLLAR_API_KEY_MAINNET`) stays empty on a
testnet deployment; with the testnet key set it is not read for sign-in.

### 2.4 Environment variables

On the Worker (`changuito-web` → Settings → Variables and Secrets). A
`NEXT_PUBLIC_*` name is a build variable instead, from the table above,
because it is inlined into the bundle. Grouped by which of the two apps
needs them.

**Always:**

| Name | Value | Exposed to |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | server only |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from Cloudflare → Turnstile | the browser, by design |
| `TURNSTILE_SECRET_KEY` | **required**, the matching secret | server only |
| `FX_ARS_PER_USD` | optional, e.g. `1500` | server only |

`KV_REST_API_URL` and `KV_REST_API_TOKEN` are optional and are not a quota
store. See [2.6](#26-conversation-history-and-quotas).

**Preview — the demo pays for itself:**

| Name | Value | Exposed to |
|---|---|---|
| `DEPOSIT_ADDRESS_TESTNET` | the `G…` account preview deposits are paid into | server only |
| `DEMO_WALLET_SECRET` | the `S…` for the account pinned as `demoWallet` | server only |

**Production — they pay, and it is remembered:**

| Name | Value | Exposed to |
|---|---|---|
| `NEXT_PUBLIC_POLLAR_API_KEY` | the **testnet** Pollar key from [2.1](#21-get-the-two-api-keys) | the browser, by design |
| `NEXT_PUBLIC_POLLAR_API_KEY_MAINNET` | empty while D1 runs on testnet | the browser, by design |
| `CHG_SESSION_SECRET` | **required**, `openssl rand -base64 32` | server only |
| `DEPOSIT_ADDRESS_MAINNET` | the `G…` operator account real deposits are paid into | server only |
| `DATABASE_URL` | the Supabase **pooler** string, port 6543 | server only |
| `REAL_MODE_ALLOWLIST_ADDRESSES` | who may pay — see [2.8](#28-who-may-pay) | server only |
| `REAL_MODE_OPEN_TO_ALL` | optional, `1` to drop that list — read [2.8](#28-who-may-pay) first | server only |

**Still configured for the escrow:**
`STELLAR_RESOLVER_SECRET` and `STELLAR_RESOLVER_SECRET_MAINNET`. Settle and
refund need the resolver secret. The faucet is not an environment variable:
after `0011_wallet.sql`, `config.faucet_open_to_all` or a
`wallet.faucet_allowed` row decides who may mint, and a ban wins over both.
Set them with `node scripts/config.mjs` and `npm run wallet`. See
[docs/flows.md](docs/flows.md#2-funding-a-wallet-testnet).

`DEPOSIT_ADDRESS_*` is **public by nature** — it is printed on screen for the
shopper to pay — and no secret for either one is anywhere near this deployment.
Nothing in the app can pay *out of* a deposit account on either network, and a
refund is done by hand. Unset, the deposit screen answers 503 and says so.

> **One open item.** The two deposit addresses are currently the same account.
> Separate ledgers, so not a collision — but one secret key then controls both
> the demo's play money and every real deposit. Splitting them costs a keypair
> and is cheaper now than later.

`DEMO_WALLET_SECRET` is the one secret key this deployment holds, and the
reason preview can settle a payment for a visitor with no wallet. It is bounded
by four separate things rather than by intent (`lib/server/demo-wallet.ts`):
the asset is play money from a locked issuer, the destination is
`DEPOSIT_ADDRESS_TESTNET` with no parameter to change it, `demoWallet` is `""`
on mainnet so a mainnet secret can never match the derived public key, and the
value is read at call time so a build without it still succeeds. Never
`NEXT_PUBLIC_`, and never echoed — not even a prefix.

`TURNSTILE_SECRET_KEY` is the one that fails *shut*. Set it and the gate
enforces; leave it unset in production and `middleware.ts` answers 403
`solo_humanos` on every `/api/*` route except `/api/human`, so chat, quote and
checkout are all dead. That is deliberate — an open agent endpoint on a public
URL bills someone's Anthropic key. The site key is public and deliberately does
**not** affect the gate, but without it the widget never mounts, so nobody can
get through.

`CHG_SESSION_SECRET` signs the `chg_user` cookie that records a Pollar login.
Production reads nothing else for it: unset, sign-in answers 503 and everyone
stays in preview. The cookie is issued only after the wallet signs a login
message (SEP-53), so an address alone is not a login. Rotating it signs
everyone out, which costs them one signature.

Only the two `NEXT_PUBLIC_` names reach the browser. Do not add the prefix to
any of the others.

### 2.5 The database

Production only. Preview writes nothing, by design and by construction — there
is no proven address in preview, so `archiveChat` answers `'guest'`, the card
binding has no owner to key on, and the order table is never reached.

1. **supabase.com → New project.** Region: the same region as the Worker.
2. **Project Settings → Database → Connection string.** Take both: the
   *transaction pooler* on port **6543** and the *direct* connection on **5432**.
3. Put them in `apps/web/.env` locally as `DATABASE_URL` and `DIRECT_URL`, with
   `?sslmode=require` on each.
4. Apply the schema:

```bash
npm run db:migrate     # supabase/migrations/*.sql, in order, over DIRECT_URL
npm run db:status      # what is applied, what is pending
npm run db:invariants  # the constraints, against the real database
```

5. On the Worker, do not set **`DATABASE_URL`** by hand. `worker.ts` copies
   the Hyperdrive binding's connection string onto it for each request.
   Migrations are a laptop operation. Workers Builds does not run them and
   does not need `DIRECT_URL`.

**The 6543/5432 difference is the part that fails only under load**, which is
why it is spelled out here rather than left to the connection-string picker.
6543 is transaction-mode pooling: a connection is held for one statement and
given back, which is exactly the shape of one request at a time on a Worker.
5432 is a session, which DDL and advisory locks need and which a request
handler must never open — `lib/db.ts` reads `DATABASE_URL` and deliberately does not read
`DIRECT_URL`, because a route that quietly took a session connection would work
perfectly in development and exhaust the database at traffic rather than at
deploy.

`prepare: false` is already passed and is not optional: the pooler rejects
named prepared statements, and the failure is a confusing "prepared statement
already exists" on the *second* request.

Nothing here throws at import. A deployment with no `DATABASE_URL` boots and
serves the chat half; the routes that need a record answer 503 rather than,
say, minting a second card for somebody who already has one.

Retention, when you get to it: expiring a transcript must **orphan** its order,
never erase it. The `chat` foreign key on `orders` deliberately does not
cascade — a conversation is a conversation and an order is evidence that money
moved (`supabase/migrations/0002_order_identity.sql`).

### 2.6 Conversation history and quotas

The chat and faucet quotas count in Postgres (`quota`, through `lib/kv.ts`).
Production without `DATABASE_URL` refuses them, so `/api/chat` and the faucet
answer 503 instead of running with no ceiling. Redis is not that store, and
the Upstash integration this section used to prescribe is not part of the
current deploy.

`KV_REST_API_URL` and `KV_REST_API_TOKEN` are optional. `lib/agent/turn-store.ts`
reads them for the in-flight conversation, with a one hour TTL. Without the
pair the turn lives in the isolate's memory and is lost on a cold start or a
deploy. A signed-in transcript is also written to Postgres, which is the
record that outlives that hour and a cleared browser. `chat-store.ts` keeps
the blocks the shopper sees in localStorage.

Leave the pair unset unless you want that turn store in Redis. If you do,
use the REST names, not `REDIS_URL` or `KV_URL`: those are `rediss://` strings
for a TCP client. A database created at upstash.com names the same endpoint
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; both are read.

### 2.8 Who may pay

`REAL_MODE_ALLOWLIST_ADDRESSES` decides who may pay with real money. Same
format and the same deny-by-default rule as the old faucet list: empty in
production means nobody. The Worker sets `NODE_ENV=production`, so that is
the live app. It is enforced **after** the
wallet's SEP-53 signature is verified, so it is checked against a proven
address rather than a claimed one. Passkey wallets (`C…`) cannot sign that
message, so testers need a custodial `G…` account.

`POST /api/deposit` goes through `lib/deposit-gate.ts` first, and `POST
/api/card` re-checks that the código it is handed belongs to a wallet that got
through. Four states, and what each means at the checkout:

| State | How you get it | At the checkout |
|---|---|---|
| **open** | not production, no list | pays with no signature — what keeps `next dev` painless, and what preview runs on |
| **allowlist** | the list is non-empty | on the list, and signs once before the deposit screen |
| **public** | `REAL_MODE_OPEN_TO_ALL` set | anybody, and **still signs once** |
| **disabled** | production, empty list | refused, before an amount or an address is quoted |

One signature, taken before any money moves, and not asked for again at the
card. A proof lives five minutes and a deposit can take longer than that to
confirm, so a second one would refuse a shopper who has already sent real USDC
— the worst available moment to fail, and one that ends in a manual refund.

`REAL_MODE_OPEN_TO_ALL=1` drops the list and lets any wallet pay. Same yes-words
as the faucet's old switch, and deliberately a separate variable. **It drops the
list, not the signature**: "anybody may pay" and "nobody has to prove who they
are" are different sentences and only the first is on offer, which costs a
signed-in shopper one tap and costs a script the whole exercise.

Two things that are **not** variables, and will stop a first real payment dead:

1. **`DEPOSIT_ADDRESS_MAINNET` needs a USDC trustline** before anyone pays into
   it. A classic asset cannot reach an account that has not opted in, and the
   payment fails at submit. Check it:

   ```bash
   node scripts/check-deposit-account.mjs mainnet
   ```

   It reports whether the account exists, whether the trustline is there, and
   whether the asset matches the issuer in `deployments.json` — Circle's
   `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` on mainnet. The
   buyer's own trustline the app handles, as a one-time step in the payment
   screen.
---

## Part 3 — the agent's model

One model answers every hop: `claude-sonnet-5`, from `ANTHROPIC_API_KEY`. That
is the whole of it, and it is worth a short section only because of what used
to be here.

**There was a local model.** Inference ran on a Mac at home over a Cloudflare
Tunnel, with the hosted model catching whatever the machine could not take —
four gates deciding per turn, a circuit breaker and a lane lease in Redis, and
a per-hop fallback so a basket could start on the laptop and finish on Sonnet.
It worked. It was also *slower* than the thing it was saving, hop after hop,
and the saving was on an API bill that was never the constraint.

It is gone, and the way it went wrong on the way out is the reason this
paragraph exists. `AGENT_PROVIDER=ollama` meant **strict local, never fall
back** — that was its whole purpose, since `auto` cannot tell you whether the
machine is really being used. So a deployment that removed `OLLAMA_URL` and
left `AGENT_PROVIDER` behind asked for a model that could no longer be reached
and forbade the only fallback: every turn died at the first hop with *"El
modelo local no está disponible"*. Two variables that had to agree, set in two
different moments. There is now one, and nothing left to disagree with it.

`AGENT_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_HEADERS`,
`OLLAMA_LANES`, `OLLAMA_FIRST_BYTE_MS` and `OLLAMA_KEEP_ALIVE` are read by
nothing. Delete them from the Worker's variables; leaving them is harmless but misleading.

### 3.1 The two knobs that are left

| | Default | |
|---|---|---|
| `AGENT_MODEL` | `claude-sonnet-5` | Haiku 4.5 runs — the request switches to a fixed thinking budget, because adaptive thinking and the effort control are Claude 5 features and Haiku rejects them outright — but in the one run measured here it stopped after the product search without building the cart |
| `AGENT_EFFORT` | `low` | `low` \| `medium` \| `high` |

`AGENT_EFFORT` is the speed knob. Adaptive thinking runs before **every** tool
call and a basket is up to twelve of them, so a second of extra deliberation
per hop is twelve seconds the shopper spends watching *"Buscando…"*. Each hop
is a small, well-posed step with the tool schemas in front of it, which is not
work that rewards deliberation. `medium` restores what shipped before; move
this first if baskets start coming back wrong rather than slow.

### 3.2 What the turn actually costs

Two cache breakpoints, and they are not decoration — the second one is most of
the latency on a long basket.

- **The prefix**: the MCP server's instructions plus `CHANGUITO_PROMPT`, with
  the tool schemas ahead of the messages. Stable for the whole conversation,
  which is exactly why per-turn state goes in the *user* message via
  `stateBanner` and never in the system prompt.
- **The messages**, marked on the newest one, moving forward each hop. Without
  it the twelve searches in a basket are re-read twelve times: hop nine pays
  full price for everything hops one through eight already said. See
  `cacheable()` in `lib/agent/loop.ts` for the three details that keep it
  correct — a shallow copy rather than a mutation, user messages only, and a
  silent no-op below the minimum cacheable length.

`AGENT_USAGE=1` logs `cache_read` and `cache_write` per hop to the server
console, which is how you check the second one is working rather than assuming.

## Part 4 — www.changuito.me and stats.changuito.me

The marketing site and the public stats dashboard are `apps/landing`
(`@changuito/landing`), not routes inside `apps/web`. Do not point
`www.changuito.me` at the shopper app, and do not point `app.changuito.me`
at the landing.

Both hosts, and the apex `changuito.me`, are custom domains on the Worker
**`changuito-landing`**. The reproducible deploy is vinext on Vite
(`apps/landing/vite.config.ts`, `worker.ts`, `cloudflare.config.ts`), the
same shape as the shopper. It needs **Node 22.18 or newer**. `.nvmrc` pins
it, and the config loader refuses anything older. `next build` still works
for a local check; production is the vinext build.

`cloudflare.config.ts` names the Worker `changuito-landing` and declares the
three hostnames it already serves (`changuito.me`, `www.changuito.me`,
`stats.changuito.me`), production only. A deploy applies that list. Do not
add a hostname, and do not drop one: a hostname left out is no longer on
this Worker. Preview URLs stay off, and `workers.dev` stays on. Nothing in
the config creates a KV namespace, a Hyperdrive, or any other resource.

`stats.changuito.me` `/` is this app's `/stats` document. `worker.ts` rewrites
that host's root before the handler. `next.config.ts` has the same rewrite
for `next dev` and `next start`. `/stats` itself is the dashboard on every
host, including `www`.

### Deploy

From the repository root, with a token that can deploy the existing Worker
`changuito-landing` (set `CLOUDFLARE_ACCOUNT_ID` as well when the token can
see more than one account). Do not put the token in the repo.

```bash
npm ci
npm run build:vinext -w @changuito/landing
npm run deploy:vinext -w @changuito/landing
```

The build command is `vite build`. The deploy command uploads that build
(`vinext-cloudflare deploy --skip-build`) and does not build again, so run
them in that order. The deploy is what publishes. This repository does not
run it.

Workers Builds, if you connect it later, uses the same commands. Root
directory `/` (the build is an npm workspace). Build command
`npm run build:vinext -w @changuito/landing`. Deploy command
`npm run deploy:vinext -w @changuito/landing`. Non-production branch builds
off. The API token is the one Workers Builds creates; the deploy reads
`CLOUDFLARE_API_TOKEN`.

### Local Workers preview

```bash
npm run build:vinext -w @changuito/landing
npm run preview:vinext -w @changuito/landing    # http://127.0.0.1:3125
```

`/` is the marketing home. `/stats` is the dashboard. The stats host is the
same server with a `Host` header:

```bash
curl -sD - -o /dev/null -H 'Host: stats.changuito.me' http://127.0.0.1:3125/
curl -sD - -o /dev/null -H 'Host: www.changuito.me' http://127.0.0.1:3125/whitelist
```

The preview is HTTP. The production CSP includes `upgrade-insecure-requests`,
so a browser on that HTTP origin rewrites script URLs to HTTPS and the page
does not hydrate. `curl` still shows the server-rendered document. On
`https://stats.changuito.me` the directive does not change the origin, and
the client runs.

`next dev` is unchanged:

```bash
npm run dev -w @changuito/landing     # http://localhost:3125
```

### Variables

Names and what each one does are in
[apps/landing/README.md](apps/landing/README.md). The shopper's deployment
does not share them.

**Build variables.** `NEXT_PUBLIC_*` is inlined into the client bundle, so it
is set in the environment of the build command, not typed into
`cloudflare.config.ts`. When the build environment has a value,
`cloudflare.config.ts` also publishes it as a Worker variable. When it does
not, the config omits that name. Do not commit the values.

| Name | Required |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | in production, or `/whitelist` has no widget |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_CLARITY_PROJECT_ID` | no |

**Worker secrets** (`changuito-landing` → Settings → Variables and Secrets,
type *Secret*). They are not in `cloudflare.config.ts`: a declared secret
with no value fails the deploy, and these are either optional or already set
on the Worker. A secret stays across deploys. Do not keep the same names as
plain text variables; a plain text variable the config does not declare can
be dropped, or the strict deploy can refuse.

| Name | Required |
|---|---|
| `TURNSTILE_SECRET_KEY` | in production, with the site key. Missing either one, `/whitelist` refuses the signup |
| `WAITLIST_WEBHOOK_URL` | in production, or the signup is refused |
| `WAITLIST_WEBHOOK_SECRET` | together with the webhook |
| `BUG_REPORT_WEBHOOK_URL`, `BUG_REPORT_WEBHOOK_SECRET` | no. Unset, `/reportarbug` still accepts the report and logs it |

`NODE_ENV=production` is set by `cloudflare.config.ts`. It is what makes
Turnstile and the waitlist sink fail closed. Do not set a second copy.

### Public stats

`/stats` reads public chain data on the request. The read has a 5.5s deadline
and the last good snapshot is reused for five minutes (edge
`stale-while-revalidate` for ten more). A source that misses the deadline is
marked unavailable and keeps its published number. No secret is required:

- Solana devnet escrow program `BFa1gZL9kVVo8Mq5gaDRM5RiCG4NDiyHLbpymfXvLz9d` (public RPC)
- Stellar testnet escrow `CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S` (from `deployments.json`) and mock USDC `CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E` (Stellar Expert and Horizon)
- merged PRs, from the public GitHub search

A source that fails or misses the deadline keeps its last published value,
and the page says the source is unavailable. The waitlist figure is live
when `STATS_WAITLIST_COUNT_URL` is set (and `WAITLIST_WEBHOOK_SECRET` is
present); otherwise it stays on the published value. Postgres, when
configured, is under the same deadline.

Optional, server-only, and only if you want app accounts, delivered orders,
or a live waitlist total. Set them as Secrets, never in the repo and never
as `NEXT_PUBLIC_`:

| Name | For |
|---|---|
| `STATS_STELLAR_DATABASE_URL` | read-only Postgres: `chat` accounts and `orders` with status `done` |
| `STATS_SOLANA_DATABASE_URL` | read-only Postgres: `profile` rows on devnet |
| `STATS_WAITLIST_COUNT_URL` | HTTPS Apps Script `doGet` that returns `{ count }`. Auth reuses `WAITLIST_WEBHOOK_SECRET` as the `secret` query parameter. Unset, the published waitlist figure stays |

`STATS_SOLANA_RPC_URL` and `STATS_STELLAR_DEPOSIT_ADDRESS` are optional
overrides of the public defaults in `lib/stats/live.ts`. Leave them unset.
If you set one, set it as a Secret too. A URL the Worker cannot reach does
not fail the page; that part keeps the published number.
