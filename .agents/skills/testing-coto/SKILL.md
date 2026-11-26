---
name: testing-coto
description: How to test the Solo Coto flow on app.changuito.me, from search to the pay modal quote, without placing a real Coto purchase. Use before changing Coto search, the Coto cart, CotoRealModal, or /api/checkout/quote.
---

# Testing Coto

**Never place a real Coto order.** Stop at the quote. Do not click
«Bloquear … y preparar el pedido», do not sign the lock in the wallet, and do
not call the sandbox job or pay step yourself. A lock starts a job that the
sandbox (Railway `joyful-nature` / `solana`) runs against coto.com.ar with the
operator card.

No secrets in notes, issues, or PRs: no wallet secret key, cookie, database
URL, `SANDBOX_URL`, `SANDBOX_TOKEN`, or card value.

## Solo Coto, step by step

1. Open `https://app.changuito.me` and sign in with a test wallet that is
   admitted for Coto pay. An account that is not admitted never sees Pay;
   that is the gate, not a bug.
2. Give a postal code (CABA works) and ask for a few products.
3. With dual compare on, pick the chain: «Seguir en Coto» (the sentence
   «Quiero seguir en Coto.»). Later searches ask Coto only.
4. Build the basket: «Armar carrito» or a card click. A Coto cart card draws
   without a store link; its lines and total match the rail.
5. Open Pay from the rail or the newest Coto card. The modal is «Pagar en
   Coto» and closes with the X in the top-right.
6. Choose «Envío a domicilio» or «Retiro en tienda», fill the address if
   asked, enter the postal code, and press «Usar este código postal». That
   posts `/api/checkout/quote`.
7. Check the quote: «Total Coto», the fee, and «Se bloquean (USDC testnet)».
   The lock button shows the amount. **Stop here.**

## What the quote can say

- «Falta una tarjeta en la cuenta. Avisamos a quien opera el súper.» with the
  lock button disabled: the Worker `changuito-web` found no `shared_card` row
  for the default network, or could not read it (`sharedCardPresent()` in
  `apps/web/lib/checkout/coto-admit.ts`). It is config. Report it; do not
  insert a card and do not change Worker secrets or bindings.
- «Iniciá sesión para pagar.»: no wallet session.
- «No pudimos cotizar ese changuito.» or a product error: a pricing failure;
  include the HTTP status from the network panel, not the body of any secret.

## Report

The URL, the steps you took, the quote lines you saw, and the exact copy of
any error. Say that you stopped before the lock.
