/**
 * Quote a deposit, then say whether it has landed.
 *
 * The amount quoted is the store's payable when a cart was named, and the
 * amount reported back is the one that landed on the ledger. A figure in the
 * request is a figure the client chose: it is the fallback only when no cart
 * was named at all, and it is never what a confirmation answers with.
 *
 * This holds no chain SDK. `activeLedger()` is the port; the Stellar adapter
 * is what that returns today, and it holds no signing key. Postgres stays a
 * direct call — the order row is the record of the memo, not a second ledger.
 *
 * ## The order row, which is not state this module reads back
 *
 * Both halves write one. The quote opens the order the memo belongs to,
 * because a late confirmation still has to find the memo it was quoted against. The
 * confirmation marks it paid when the payment shows up, because the poll is
 * the only place confirmation is ever observed and an order stuck at `quoted`
 * for a shopper who has paid is a record that lies.
 *
 * Neither write changes what either half *answers*. The ledger is still the
 * authority: a confirmation reports what the port says whether or not the
 * UPDATE lands, and a database that is down costs a record rather than a
 * payment. That is why both are best-effort and logged, and why `markPaid` is
 * monotonic — the browser polls every four seconds and keeps confirming long
 * after the shopper has already been told the money arrived.
 *
 * Confirming the same deposit as many times as it is asked proves the money
 * arrived.
 */
import { arsToUsdCents, getArsPerUsd } from '@changuito/mcp/fx';

import { modeForSession, modeKeepsRecords, type AppMode } from '../app-mode.ts';
import { hasDatabase, markPaid, openChatOrder, openOrder, orderByMemo } from '../db.ts';
import type { NetworkId } from '../deployments.ts';
import { requestNetwork } from '../server-network.ts';
import { isMemo, mintMemo, type DepositAsset } from '../deposit.ts';
import { authorizeRealMode, realModeNeedsProof } from '../deposit-gate.ts';
import { activeLedger } from '../ledger/index.ts';
import { orderFormIdFrom, readOrderForm } from '../order-check.ts';
import { canDemoPay } from '../server/demo-wallet.ts';
import { proofFromBody } from '../wallet-proof-verify.ts';

/** Session facts the HTTP layer verified via `readLoggedInUser`. */
export interface DepositSession {
  mode: AppMode;
  /** Cookie address when signed in; owns a testnet deposit that needs no proof. */
  address: string | null;
}

export interface DepositIntent {
  network: NetworkId;
  address: string;
  asset: DepositAsset;
  memo: string;
  /** The figure to send, as a 7-decimal string — what a wallet wants pasted in. */
  amount: string;
  /** The basket, for the line the shopper reads. */
  centavos: number;
  usdCents: number;
  arsPerUsd: number;
  source: string;
  /**
   * Whether this deployment can pay the deposit itself. True only in preview,
   * and only where `DEMO_WALLET_SECRET` is actually set. Answered here rather
   * than in a `NEXT_PUBLIC_` flag: the browser learns it from the server that
   * would have to honour it, so a deployment without the secret never renders
   * a button that 503s. A preview shopper who gets `false` sees the address
   * and the memo instead, which is the manual path and still works.
   */
  demoPayable: boolean;
}

export interface DepositStatus {
  status: 'waiting' | 'confirmed';
  txHash?: string;
  /** What actually arrived, which is not always what was quoted. */
  amount?: string;
  at?: string;
}

export type DepositReply =
  | { status: 200; body: DepositIntent | DepositStatus }
  | { status: number; body: { error: string; message?: string } };

/**
 * The buffer is 15%. The escrow path quotes at zero buffer because it settles
 * the exact number it locked; this one does not, because the rate can move
 * between the quote and the payment.
 */
const BUFFER = 0.15;

/**
 * Record that this memo was issued, and to whom.
 *
 * `address` is omitted when nothing was proven — writing a claimed address
 * down would be recording a guess. With no database the same fact lives in
 * an in-process map, which is what a fresh clone and the unit tests use.
 * It does not survive a restart, and production does not use it.
 */
const localOwners = new Map<string, string>();
const localKey = (net: NetworkId, memo: string) => `${net}:${memo}`;

export async function rememberDepositor(
  net: NetworkId,
  memo: string,
  o: {
    /** Omitted when no address was proven. */
    address?: string;
    /** What the deposit was quoted at, in US cents. */
    amountCents: number;
    /** The centavos figure the shopper actually read on screen. */
    arsQuoted?: number;
    cartId?: string;
  },
): Promise<void> {
  if (!hasDatabase()) {
    if (o.address) localOwners.set(localKey(net, memo), o.address);
    return;
  }
  await openOrder({
    network: net,
    memo,
    address: o.address ?? null,
    amountCents: o.amountCents,
    arsQuoted: o.arsQuoted ?? null,
    cartId: o.cartId ?? null,
  });
}

/** The wallet that opened this deposit, or undefined if nothing recorded one. */
export async function depositorOf(net: NetworkId, memo: string): Promise<string | undefined> {
  if (!hasDatabase()) return localOwners.get(localKey(net, memo));
  return (await orderByMemo(net, memo))?.address ?? undefined;
}


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function networkFrom(value: string | null): NetworkId | null {
  // Coerce unrecognized values the way this rail always did — a typo must not
  // 400 a quote whose contract is to answer. Recognized-but-unserved still
  // refuses.
  const asked = requestNetwork(value, undefined, undefined, 'default');
  return asked.ok ? asked.network : null;
}

/**
 * The deposit figure, in whichever asset this network takes.
 *
 * On mainnet the asset is USDC and this is a conversion: one USDC is one US
 * dollar, so US cents divided by a hundred is the amount.
 *
 * On testnet it is the same conversion, and now for the same reason: since
 * scripts/setup-demo-asset.mjs the testnet asset is a classic USDC of our own
 * rather than lumens, so one unit is one dollar there too and the figure is
 * the figure. It used to be XLM — the old mock USDC was a Soroban token with
 * no classic payment record to carry a memo — and the number was deliberately
 * *not* an XLM price, because there is no XLM/ARS feed in this app and
 * inventing one to move play money would have been a lie with a decimal point
 * in it. That awkwardness is gone; the copy still says "de prueba".
 */
export function depositAmount(usdCents: number): string {
  return (usdCents / 100).toFixed(7);
}

export async function quoteDeposit(
  body: unknown,
  session: DepositSession = { mode: modeForSession(false), address: null },
): Promise<DepositReply> {
  const input = (body ?? {}) as {
    centavos?: unknown;
    network?: unknown;
    address?: unknown;
    chatId?: unknown;
    retailer?: unknown;
    handoffUrl?: unknown;
    settled?: unknown;
  };

  const claimed = Number(input.centavos);
  if (!Number.isInteger(claimed) || claimed <= 0) {
    return { status: 400, body: { error: 'centavos must be a positive integer' } };
  }

  const network = networkFrom(typeof input.network === 'string' ? input.network : null);
  if (!network) {
    return { status: 400, body: { error: 'network_not_served' } };
  }

  // The conversation this basket came out of, when there is one. Absent is
  // ordinary — preview has no chat to file anything against — but a string
  // that is not a uuid is a bug in the caller, and `chat.id` is a uuid. Said
  // out loud rather than dropped: silently ignoring it would open a second
  // order for a chat that already has one, which is the rule this carries.
  let chatId: string | undefined;
  if (input.chatId !== undefined && input.chatId !== null) {
    if (typeof input.chatId !== 'string' || !UUID.test(input.chatId)) {
      return { status: 400, body: { error: 'chatId must be a uuid' } };
    }
    chatId = input.chatId;
  }

  // Before anything that costs, and before the operator address is even looked
  // up. A wallet that may not use this network is told so and nothing else.
  const auth = authorizeRealMode({
    address: typeof input.address === 'string' ? input.address : '',
    proof: proofFromBody(body),
    now: Date.now(),
    net: network,
  });
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error, message: auth.message } };
  }

  const books = activeLedger();
  const address = books.receiveAddress(network);
  if (!address) {
    // Not configured is not the shopper's problem to decode, but it is
    // absolutely the operator's, so the log says which variable is missing.
    console.error(`[deposit] no DEPOSIT_ADDRESS_${network.toUpperCase()} set`);
    return { status: 503, body: { error: 'los pagos no están habilitados en este entorno' } };
  }

  // The browser does not get to name the price. When the caller hands over the
  // cart it is checking out, the total is read from the store's own orderForm
  // here, and whatever the browser claimed is discarded — see `storeTotal`.
  //
  // The claimed figure is still the fallback, for the two callers that have no
  // store cart to read: `PaymentModal`, and the `/dev/checkout` rehearsal,
  // which is a fixture with no orderForm behind it at all.
  const quoted = await storeTotal(input.retailer, input.handoffUrl, input.settled === true);
  if (quoted?.kind === 'unsettled') {
    return {
      status: 409,
      body: {
        error: 'delivery_not_chosen',
        message: 'Todavía falta elegir el envío en el súper.',
      },
    };
  }
  if (quoted?.kind === 'unreadable') {
    return {
      status: 409,
      body: {
        error: 'cart_unreadable',
        message: 'No pudimos leer el changuito en el súper en este momento. Probá de nuevo en un minuto.',
      },
    };
  }
  const centavos = quoted?.kind === 'read' ? quoted.centavos : claimed;

  try {
    const override = Number(process.env.FX_ARS_PER_USD);
    const rate = await getArsPerUsd(Number.isFinite(override) && override > 0 ? { override } : {});
    const usdCents = arsToUsdCents(centavos, rate.arsPerUsd, BUFFER);

    // The order is opened for every memo, so a confirmation that arrives late
    // needs always has a row to latch onto. The *address* is written when the
    // signature above proved one, or — on a signed-in testnet session where
    // the gate needs no proof — when the cookie named one. Recording a body
    // address with no proof would be writing down a guess; the cookie is
    // the identity the server already verified.
    const depositor = realModeNeedsProof(auth.mode)
      ? (input.address as string).trim().toUpperCase()
      : session.address
        ? session.address.trim().toUpperCase()
        : undefined;

    // One chat is one order, and this is where that stops being a rule the
    // browser keeps. ShopProvider already refuses to let a shopper type a
    // second basket into a paid chat; this refuses to *quote* one, which is
    // the half that matters, because a rule about money does not get to live
    // in a browser.
    //
    // The memo comes back from the database rather than from `mintMemo()` when
    // a chat already has an unclaimed order: a deposit sent against the old
    // código still matches, so a shopper who paid and then reloaded is not
    // stranded with real money against a memo nothing will ever look for.
    //
    // Mode comes from the cookie the HTTP layer verified — not from whether
    // a depositor string happened to be set (that used to be a tautology on
    // mainnet and a silent no-op on signed-in testnet).
    const order = chatId && modeKeepsRecords(session.mode) && hasDatabase()
      ? await openChatOrder({
          network,
          chatId,
          memo: mintMemo(),
          address: depositor,
          amountCents: usdCents,
          arsQuoted: centavos,
        }).catch((err) => {
          console.error('[deposit] could not open the chat order:', message(err));
          return null;
        })
      : null;

    if (order?.kind === 'closed') {
      return {
        status: 409,
        body: {
          error: 'order_closed',
          message: 'Esta conversación ya tiene una compra. Empezá un chat nuevo para comprar de nuevo.',
        },
      };
    }
    if (order && !order.linked) {
      // The order exists and works; it just is not filed under the chat, so
      // the one-per-chat rule is not holding it. Worth a line, because the
      // cause is upstream — a conversation that never got archived.
      console.warn(`[deposit] ${network}:${order.order.memo} opened without chat ${chatId}`);
    }

    const memo = order?.order.memo ?? mintMemo();

    // No chat id, or no database to file one against: the old path, which
    // records the same fact with no conversation attached.
    //
    // A failure here is not the shopper's problem *yet*. The memo was still
    // issued. Loud, because the row is the record of who it was quoted to.
    if (!order) {
      await rememberDepositor(network, memo, {
        address: depositor,
        amountCents: usdCents,
        arsQuoted: centavos,
      }).catch((err) => {
        console.error('[deposit] could not record the deposit:', message(err));
      });
    }

    const intent: DepositIntent = {
      network,
      address,
      asset: books.asset(network),
      memo,
      amount: depositAmount(usdCents),
      centavos,
      usdCents,
      arsPerUsd: rate.arsPerUsd,
      source: rate.source,
      demoPayable: canDemoPay(network),
    };
    return { status: 200, body: intent };
  } catch (err) {
    // assertSaneRate throws rather than returning a bad number. Refusing to
    // quote is correct: the alternative is pricing a basket off a feed that
    // said one peso to the dollar.
    return { status: 502, body: { error: `no pudimos cotizar el carrito: ${message(err)}` } };
  }
}

export async function confirmDeposit(q: {
  memo: string;
  amount: string;
  network: string | null;
}): Promise<DepositReply> {
  const network = networkFrom(q.network);
  if (!network) return { status: 400, body: { error: 'network_not_served' } };

  if (!isMemo(q.memo)) return { status: 400, body: { error: 'memo inválido' } };
  if (!/^\d+(\.\d{1,7})?$/.test(q.amount)) return { status: 400, body: { error: 'monto inválido' } };

  const books = activeLedger();
  const address = books.receiveAddress(network);
  if (!address) return { status: 503, body: { error: 'los pagos no están habilitados en este entorno' } };

  try {
    const hit = await books.findDeposit(network, {
      to: address,
      asset: books.asset(network),
      memo: q.memo,
      minAmount: q.amount,
    });
    if (hit) {
      // Best effort, and deliberately not awaited into the answer: the ledger
      // said the money arrived, and that is true whether or not the row can be
      // written. Failing the poll over a database would tell a shopper who has
      // paid that they have not.
      //
      // `markPaid` is monotonic. The browser polls every few seconds and keeps
      // confirming long after the shopper was told the money arrived.
      await markPaid(network, q.memo, hit.txHash).catch((err) => {
        console.error(`[deposit] ${network}:${q.memo} confirmed but not recorded:`, message(err));
      });
    }
    const body: DepositStatus = hit
      ? { status: 'confirmed', txHash: hit.txHash, amount: hit.amount, at: hit.at }
      : { status: 'waiting' };
    return { status: 200, body };
  } catch (err) {
    // The ledger being unreachable is not "no deposit" — saying so would tell
    // a shopper who has already paid that they have not.
    console.error('[deposit] ledger read failed:', message(err));
    return { status: 502, body: { error: 'no pudimos consultar la red en este momento' } };
  }
}

/**
 * The exact total, read from the store's own cart.
 *
 * This is the change the whole reorder exists for. The deposit used to be
 * quoted from `cart.total`, which is the goods subtotal by design — see
 * `payableTotal` in `@changuito/mcp/orderform` — so the shopper was charged
 * before a delivery slot existed and for a number that did not include envío.
 * Now the caller hands over *which cart*, and the amount comes from the
 * document.
 *
 * Four outcomes, and the middle two matter:
 *
 * - `undefined` — no cart was named at all. The caller falls back to the
 *   figure the browser claimed, which is what it always did, and which is
 *   what keeps `PaymentModal` and the `/dev/checkout` rehearsal working: both
 *   are baskets with no store orderForm behind them.
 * - `unsettled` — the cart was read and the shopper has not chosen a delivery
 *   yet, so the shipping line is not in the total. Quoting here would
 *   reintroduce the exact bug this replaces, so it is a refusal instead.
 * - `unreadable` — a cart *was* named and the store could not be asked, or
 *   answered with no usable total. Also a refusal; see below.
 * - `read` — the payable total, envío included.
 *
 * Note what is *not* here: no fallback to the claimed figure once a cart has
 * been named. A caller that names a cart is quoted from that cart or not at
 * all; letting it fall back would make the server-side read advisory, and an
 * advisory price check is not one. That is why the store being briefly
 * unreachable is a 409 the shopper can act on rather than a quiet reversion
 * to the wrong number.
 *
 * ## `settled` skips the wait and nothing else
 *
 * It is the browser saying the shopper told us they picked a delivery — the
 * escape hatch for a store that does not hand `shippingData.logisticsInfo` to
 * a reader with no session. It can only ever suppress the `unsettled`
 * refusal. It cannot name a figure, and the figure is still read from the
 * store's own document either way, so the rule the whole change rests on —
 * the browser does not name its own price — survives it intact.
 */
async function storeTotal(
  retailer: unknown,
  handoffUrl: unknown,
  settled: boolean,
): Promise<
  { kind: 'read'; centavos: number } | { kind: 'unsettled' } | { kind: 'unreadable' } | undefined
> {
  if (typeof retailer !== 'string' || typeof handoffUrl !== 'string') return undefined;
  const orderFormId = orderFormIdFrom(handoffUrl);
  if (!retailer || !orderFormId) return undefined;

  // `itemsAtHandoff: 0` because `looksPaid` is not being asked here — a zero
  // makes that flag false whatever the cart says, which is correct: this call
  // is about the price, and nothing reads the verdict.
  const state = await readOrderForm({ retailer, orderFormId, itemsAtHandoff: 0 });
  if (!state) return { kind: 'unreadable' };
  if (!state.slotChosen && !settled) return { kind: 'unsettled' };
  if (!Number.isInteger(state.payable) || state.payable <= 0) return { kind: 'unreadable' };
  return { kind: 'read', centavos: state.payable };
}
