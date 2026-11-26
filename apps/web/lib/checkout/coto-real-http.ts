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
import { adminStore } from '../admin/store.ts';
import { admitCotoRequest, sharedCardPresent } from './coto-admit.ts';
import {
  COTO_REAL_KIND,
  MISSING_CARD_COPY,
  MISSING_CITY_COPY,
  normalizePostal,
  quoteBuyerError,
  quoteFromPriced,
  type Fulfillment,
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
    fulfillment?: unknown;
    city?: unknown;
    street?: unknown;
    number?: unknown;
    complement?: unknown;
  },
): Promise<Response> {
  if (body.payRetailer !== undefined || body.acceptedAlternatives !== undefined || body.checkoutPath !== undefined) {
    return Response.json({ error: BLOCKED }, { status: 400 });
  }
  if (!(await admitCotoRequest(address))) {
    return Response.json({ error: BLOCKED }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' && UUID.test(body.sessionId) ? body.sessionId : '';
  const turn = sessionId ? await readTurn(sessionId) : undefined;
  // No Día snapshot is an empty comparison: no pairs, a 0 gap, a 0 fee.
  const snapshot = turn?.cache.cotoRealDia;
  const buyerError = quoteBuyerError(snapshot, address);
  if (buyerError) return Response.json({ error: buyerError }, { status: 400 });

  const edited = typeof body.postalCode === 'string' ? body.postalCode : undefined;
  const chatPostal =
    body.location && typeof body.location === 'object' && typeof (body.location as { postalCode?: unknown }).postalCode === 'string'
      ? (body.location as { postalCode: string }).postalCode
      : undefined;
  const rawPostal = edited ?? chatPostal;
  if (!rawPostal) {
    console.warn('coto-pay gate=postal');
    return Response.json(
      { error: 'Falta tu código postal. Contale al chat dónde estás y volvé a intentar.' },
      { status: 400 },
    );
  }
  const postalCode = normalizePostal(rawPostal);
  if (!postalCode) {
    console.warn('coto-pay gate=postal');
    return Response.json({ error: 'Ese código postal no es válido.' }, { status: 400 });
  }
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  if (!city) {
    console.warn('coto-pay gate=city');
    return Response.json({ error: MISSING_CITY_COPY }, { status: 400 });
  }
  const fulfillment: Fulfillment = body.fulfillment === 'pickup' ? 'pickup' : 'home';
  const street = typeof body.street === 'string' ? body.street.trim() : '';
  const number = typeof body.number === 'string' ? body.number.trim() : '';
  const complement = typeof body.complement === 'string' ? body.complement.trim() : '';
  if (fulfillment === 'home' && (!street || !number)) {
    console.warn('coto-pay gate=street');
    return Response.json({ error: 'Falta la calle o el número de esta compra.' }, { status: 400 });
  }

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
    pairs: snapshot?.pairs ?? [],
    postalCode,
    coverage: 'shopper',
    fulfillment,
  });
  if (!quoted.ok) return Response.json({ error: quoted.error }, { status: 400 });
  if (!(await sharedCardPresent())) {
    console.warn('coto-pay gate=card');
    try {
      await adminStore().notifyOnce('missing_card', null, 'Falta la tarjeta de la cuenta.');
    } catch (err) {
      console.error('[checkout/coto] missing-card notice', err instanceof Error ? err.name : 'insert');
    }
    return Response.json({ error: MISSING_CARD_COPY }, { status: 409 });
  }

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
    city,
    fulfillment,
    shippingProvisionCentavos: quoted.quote.shippingProvisionCentavos,
    ...(fulfillment === 'home'
      ? {
          resolvedAddress: {
            postalCode,
            street,
            number,
            city,
            ...(complement ? { complement } : {}),
          },
        }
      : {}),
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
