/**
 * The quote branch for checkoutKind coto_real_v1.
 * It stores the lock the escrow will open. It does not call the demo quote.
 */
import { arsToUsdCents } from '@changuito/mcp/fx';
import { cotoPricer, priceCotoCart } from '@changuito/mcp/compare';
import type { Cart } from '@changuito/mcp/types';

import { turnStore, type TurnStore } from '../agent/turn-store.ts';
import { contractIds } from '../contract-ids.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';
import { basketHash, DEFAULT_TIMEOUT_SECS, newOrderId, toHex } from '../order.ts';
import { centsToUnits } from '../stellar.ts';
import { checkoutStore } from './store.ts';
import { quoteRate } from './rate.ts';
import {
  admitCotoReal,
  COTO_REAL_KIND,
  coverageAddress,
  normalizePostal,
  parseAllowlist,
  parseCpTable,
  parseOpsAddress,
  quoteBuyerError,
  quoteFromPriced,
  resolveCoverage,
  type PricedLine,
} from './coto-real.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCKED = 'Ese súper no se puede pagar desde acá.';

type TurnReader = TurnStore['get'];
let readTurn: TurnReader = (sessionId) => turnStore().get(sessionId);

/** Tests pass a memory reader so a quote check never touches Redis. */
export function __setCotoRealTurnReaderForTests(reader: TurnReader | null): void {
  readTurn = reader ?? ((sessionId) => turnStore().get(sessionId));
}

export async function postCotoRealQuote(
  address: string,
  cart: Cart,
  body: {
    postalCode?: unknown;
    location?: unknown;
    sessionId?: unknown;
    payRetailer?: unknown;
    acceptedAlternatives?: unknown;
    checkoutPath?: unknown;
  },
): Promise<Response> {
  if (body.payRetailer !== undefined || body.acceptedAlternatives !== undefined || body.checkoutPath !== undefined) {
    return Response.json({ error: BLOCKED }, { status: 400 });
  }
  const enabled = process.env.COTO_REAL_ENABLED === '1';
  const allowlist = parseAllowlist(process.env.COTO_REAL_ALLOWLIST);
  if (!admitCotoReal({ address, enabled, allowlist })) {
    return Response.json({ error: BLOCKED }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' && UUID.test(body.sessionId) ? body.sessionId : '';
  const turn = sessionId ? await readTurn(sessionId) : undefined;
  const buyerError = quoteBuyerError(turn?.cache.cotoRealDia, address);
  if (buyerError) return Response.json({ error: buyerError }, { status: 400 });
  const snapshot = turn?.cache.cotoRealDia;
  if (!snapshot) return Response.json({ error: 'Volvé a comparar antes de pagar.' }, { status: 400 });

  const edited = typeof body.postalCode === 'string' ? body.postalCode : undefined;
  const chatPostal =
    body.location && typeof body.location === 'object' && typeof (body.location as { postalCode?: unknown }).postalCode === 'string'
      ? (body.location as { postalCode: string }).postalCode
      : undefined;
  const rawPostal = edited ?? chatPostal;
  if (!rawPostal) {
    return Response.json(
      { error: 'Falta tu código postal. Contale al chat dónde estás y volvé a intentar.' },
      { status: 400 },
    );
  }
  const postalCode = normalizePostal(rawPostal);
  if (!postalCode) return Response.json({ error: 'Ese código postal no es válido.' }, { status: 400 });

  const coverageOpts = {
    ops: parseOpsAddress(process.env.COTO_REAL_OPS_ADDRESS),
    table: parseCpTable(process.env.COTO_REAL_CP_TABLE),
  };
  const resolved = coverageAddress(postalCode, coverageOpts);
  const coverage = resolveCoverage(postalCode, coverageOpts);
  if (!resolved || !coverage.ok) return Response.json({ error: 'No tenemos cobertura para ese CP' }, { status: 400 });

  let lines: PricedLine[];
  try {
    const priced = await priceCotoCart(
      cart.cartId,
      cart.lines.map((line) => ({ id: line.skuId, quantity: line.quantity })),
      cotoPricer(),
    );
    lines = priced.lines.map((line) => ({
      skuId: line.skuId,
      name: line.name,
      quantity: line.quantity,
      unitCentavos: line.unitPrice.centavos,
      available: line.available,
    }));
  } catch {
    return Response.json({ error: 'No pudimos cotizar un producto de Coto.' }, { status: 400 });
  }

  const quoted = quoteFromPriced({
    lines,
    clientTotalCentavos: cart.total.centavos,
    pairs: snapshot.pairs,
    postalCode,
    coverage: coverage.coverage,
  });
  if (!quoted.ok) return Response.json({ error: quoted.error }, { status: 400 });

  let rate;
  try {
    const override = Number(process.env.ARS_PER_USD);
    rate = await quoteRate(Number.isFinite(override) && override > 0 ? { override } : {});
  } catch {
    return Response.json({ error: 'No pudimos cotizar el cambio. Probá de nuevo en un rato.' }, { status: 503 });
  }
  const amountCents = arsToUsdCents(quoted.quote.lockCentavos as never, rate.arsPerUsd, 0);
  const amount = centsToUnits(amountCents).toString();
  const orderId = toHex(newOrderId());
  const hash = toHex(await basketHash(pricedCart(cart.cartId, lines, quoted.quote.cotoTicketCentavos)));
  const ids = contractIds(DEFAULT_NETWORK);
  await checkoutStore().set({
    checkoutKind: COTO_REAL_KIND,
    orderId,
    buyer: address,
    amount,
    amountCents,
    basketHash: hash,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    postalCode,
    resolvedAddress: resolved,
    totalDisplay: quoted.quote.lockCentavos.toString(),
    retailer: 'coto',
    lines: lines.map((line) => ({
      name: line.name,
      skuId: line.skuId,
      quantity: line.quantity,
      lineTotal: String(line.unitCentavos * line.quantity),
    })),
    handoffUrl: null,
    createdAt: Date.now(),
    mode: 'live',
  });
  return Response.json({
    ...quoted.quote,
    checkoutKind: COTO_REAL_KIND,
    coverage: 'ok',
    orderId,
    basketHash: hash,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    programId: ids.escrowId,
    usdcMint: ids.usdcId,
    amount,
    amountCents,
    amountDisplay: `${(amountCents / 100).toFixed(2)} USDC`,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
  });
}

function pricedCart(cartId: string, lines: readonly PricedLine[], ticketCentavos: number): Cart {
  return {
    retailer: 'coto',
    cartId,
    messages: [],
    total: { centavos: ticketCentavos, display: String(ticketCentavos) },
    lines: lines.map((line, index) => ({
      index,
      skuId: line.skuId,
      name: line.name,
      quantity: line.quantity,
      sellerId: 'coto',
      unitPrice: { centavos: line.unitCentavos, display: String(line.unitCentavos) },
      lineTotal: { centavos: line.unitCentavos * line.quantity, display: String(line.unitCentavos * line.quantity) },
      available: line.available,
    })),
  };
}
