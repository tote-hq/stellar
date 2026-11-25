/**
 * POST /api/checkout/quote { cart, handoffUrl?, compare? }  ->  QuoteResponse
 *
 * `compare: true` is only a flag. The server looks up Día and the Coto catalog
 * and prices the fee. The browser never sends a price. That quote skips the
 * 0.10 preparation fee and locks the Día basket plus 20% of the matched gap.
 *
 * Turns the basket on screen into the arguments of `escrow.open`: a fresh
 * order id, the basket hash, and how much USDC to lock. The browser builds
 * the instruction from these and the shopper's wallet signs it; the server
 * never touches the buyer's money until it has the order on chain.
 *
 * The amount is the goods plus the envío, at belo's USDC rate
 * (lib/checkout/rate.ts). The envío comes from VTEX's simulation at the
 * shopper's postal code, picked by the same rule the sandbox uses at Día's
 * checkout (lib/checkout/shipping.ts), so the modal shows it as its own line
 * instead of hiding it in a buffer. QUOTE_BUFFER (default 0) adds slack on
 * top if a window's price starts moving between quote and run.
 */
import { compareDiaToCoto } from '@changuito/mcp/compare';
import { arsToUsdCents } from '@changuito/mcp/fx';
import type { Cart, CartLine } from '@changuito/mcp/types';

import { comparisonTotals, countsTowardFee, feeUsdFrom, type ComparisonQuote, type ComparisonRow, type FeeBasis } from '../../../../lib/checkout/compare-fee.ts';
import { cotoCheckoutBlocked } from '../../../../lib/checkout/coto-guard.ts';
import { COTO_REAL_KIND } from '../../../../lib/checkout/coto-real.ts';
import { postCotoRealQuote } from '../../../../lib/checkout/coto-real-http.ts';
import { quoteRate } from '../../../../lib/checkout/rate.ts';
import { NO_DELIVERY, quoteShipping, type ShippingLocation } from '../../../../lib/checkout/shipping.ts';
import { checkoutStore } from '../../../../lib/checkout/store.ts';
import { sandboxFlags, getConfig, flagOn, memberFlow, retailerSearch } from '../../../../lib/config.ts';
import { checkoutMode } from '../../../../lib/checkout/mode.ts';
import { manualAvailable, manualMember, manualStatus } from '../../../../lib/checkout/manual-server.ts';
import { MANUAL_KIND, SERVICE_FEE_CENTS, SERVICE_FEE_UNITS, serviceOrderId, VIEWER_SECONDS } from '../../../../lib/checkout/manual-policy.ts';
import { hasDatabase, db } from '../../../../lib/db.ts';
import type { CheckoutRecord } from '../../../../lib/checkout/store.ts';
import { getProfile } from '../../../../lib/profile.ts';
import type { QuoteResponse } from '../../../../lib/checkout/types.ts';
import { DEFAULT_NETWORK } from '../../../../lib/deployments.ts';
import { contractIds } from '../../../../lib/contract-ids.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';
import { basketHash, DEFAULT_TIMEOUT_SECS, newOrderId, toHex } from '../../../../lib/order.ts';
import { centsToUnits } from '../../../../lib/stellar.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buffer(): number {
  const b = Number(process.env.QUOTE_BUFFER ?? 0);
  return Number.isFinite(b) && b >= 0 && b <= 0.5 ? b : 0;
}

function isLocation(l: unknown): l is ShippingLocation {
  const x = l as ShippingLocation;
  return Boolean(x && typeof x.postalCode === 'string' && /^[A-Za-z0-9]{4,8}$/.test(x.postalCode));
}

function isCart(c: unknown): c is Cart {
  const x = c as Cart;
  return Boolean(x && typeof x.cartId === 'string' && Array.isArray(x.lines) && typeof x.total?.centavos === 'number');
}

export async function POST(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión para pagar.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    cart?: unknown;
    handoffUrl?: unknown;
    location?: unknown;
    compare?: unknown;
    payRetailer?: unknown;
    acceptedAlternatives?: unknown;
    checkoutPath?: unknown;
    checkoutKind?: unknown;
    postalCode?: unknown;
    sessionId?: unknown;
  } | null;
  if (!isCart(body?.cart)) return Response.json({ error: 'Falta el changuito.' }, { status: 400 });
  const cart = body.cart;
  // Above the blanket Coto refusal. A wallet that is not admitted gets that
  // same refusal and does not fall through to the demo or the Día quote.
  if (cart.retailer === 'coto' && body.checkoutKind === COTO_REAL_KIND) {
    return postCotoRealQuote(user.address, cart, body);
  }
  if (cotoCheckoutBlocked(cart.retailer)) {
    return Response.json({ error: 'Ese súper no se puede pagar desde acá.' }, { status: 400 });
  }
  // A client cart whose retailer is Coto stayed blocked above. The demo pays
  // accepted Coto alternativas of a Día basket, and the browser sends no amount.
  if (body.payRetailer !== undefined && body.payRetailer !== 'coto') {
    return Response.json({ error: 'Ese súper no se puede pagar desde acá.' }, { status: 400 });
  }
  const acceptedAlternatives = parseAccepted(body.acceptedAlternatives);
  const checkoutPath = parseCheckoutPath(body.checkoutPath);
  if (body.payRetailer === 'coto') {
    return quoteCotoDemo(user.address, cart, body.location, acceptedAlternatives, checkoutPath ?? 'solo_coto');
  }
  // Fee vs similars when the client asks (`compare: true`) — dual and solo Día
  // demo pays set it. Ordinary checkout never does.
  const compare = body.compare === true;
  if (compare && cart.retailer !== 'dia') {
    return Response.json({ error: 'La comparación solo está disponible para un changuito de Día.' }, { status: 400 });
  }
  const lines = cart.lines.filter((l) => l.available && l.quantity > 0);
  if (lines.length === 0 || cart.total.centavos <= 0) {
    return Response.json({ error: 'El changuito está vacío.' }, { status: 400 });
  }
  // Resume funded sessions across a full app reload without another fee lock.
  // A compared quote must not resume into the 0.10 record.
  const currentHash = toHex(await basketHash(cart));
  if (!compare && hasDatabase()) {
    try {
      const rows = await db()`select record from manual_checkout where record->>'buyer'=${user.address}
        and record->>'basketHash'=${currentHash} and (record->>'openSig' is not null or record->>'jobId' is not null)
        and (record->'manual'->>'sessionActive'='true' or
          (record->>'outcome' is null and (record->'manual'->>'preparedAt') is null))
        order by updated_at desc limit 1`;
      const rec = rows[0]?.record as CheckoutRecord | undefined;
      if (rec) return Response.json({
        checkoutKind: MANUAL_KIND, orderId: rec.orderId, orderNonce: rec.orderNonce, feeReleaseBasis: 'checkout_prepared',
        viewerDurationSecs: VIEWER_SECONDS, amount: rec.amount, amountCents: 10, amountDisplay: '0.10',
        basketHash: rec.basketHash, timeoutSecs: DEFAULT_TIMEOUT_SECS, arsPerUsd: rec.arsPerUsd,
        rateSource: rec.rateSource ?? '', subtotalCentavos: cart.total.centavos, shippingCentavos: rec.shippingCentavos ?? 0,
        totalCentavos: cart.total.centavos + (rec.shippingCentavos ?? 0), postalCode: rec.postalCode,
        postalSource: 'profile', chatPostalCode: null, programId: contractIds(DEFAULT_NETWORK).escrowId,
        usdcMint: contractIds(DEFAULT_NETWORK).usdcId, mode: 'live', resumeStatus: manualStatus(rec),
        ...(rec.manualFlow ? { manualFlow: rec.manualFlow } : {}),
      }, { headers: { 'cache-control': 'no-store' } });
    } catch (err) { if ((err as { code?: string }).code !== '42P01') throw err; }
  }

  // An admitted manual checkout is a wallet on allowlist with
  // dia_manual_enabled (the historical name was shared_card_member; the table
  // is not a card) while manual checkout is
  // enabled. Everyone else gets the demo run: same lock, the mock stops at
  // payment, refund, and the cart link to finish in Día. Mock mode wins, the
  // way it always did, so a rehearsal never opens the manual path. Asked here
  // so the modal can say which run this is before anything is locked.
  const config = await getConfig();
  const flags = await sandboxFlags();
  // The compared basket locks goods plus the 20% fee. It is never the 0.10 preparation fee.
  const manual = !compare && !flags.mock && (await manualMember(user.address)) && flagOn(config, 'manual_checkout_enabled');
  const mode = checkoutMode({ mock: flags.mock, manual });
  const manualFlow = memberFlow(manual, config);
  if (manual && (!hasDatabase() || !(await manualAvailable()))) {
    return Response.json({ error: 'El navegador de pago no está disponible. Probá más tarde.' }, { status: 503 });
  }

  // The postal code the shopper browsed with: prices, stock and envío are all quoted per area.
  // The profile's postcode wins over the chat's: it is where the shopper said
  // they live, and where the sandbox will deliver.
  let saved: string | undefined;
  try {
    saved = (await getProfile(user.address))?.postcode;
  } catch (err) {
    console.warn('[checkout] profile unreadable for quote', err instanceof Error ? err.name : err);
  }
  const chatPostal = isLocation(body.location) ? body.location.postalCode : undefined;
  if (saved) body.location = { ...(isLocation(body.location) ? body.location : {}), postalCode: saved };
  if (!isLocation(body.location)) {
    return Response.json({ error: 'Falta tu código postal. Contale al chat dónde estás y volvé a intentar.' }, { status: 400 });
  }
  const location = body.location;

  const override = Number(process.env.ARS_PER_USD);
  let rate, shipping;
  try {
    [rate, shipping] = await Promise.all([
      quoteRate(Number.isFinite(override) && override > 0 ? { override } : {}),
      quoteShipping(cart.retailer, lines, location),
    ]);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn('[checkout] quote failed', why);
    if (why.startsWith(NO_DELIVERY)) {
      return Response.json({ error: 'Día no hace envíos a domicilio a tu código postal.' }, { status: 409 });
    }
    return Response.json({ error: 'No pudimos cotizar el envío o el cambio. Probá de nuevo en un rato.' }, { status: 503 });
  }
  const totalCentavos = cart.total.centavos + shipping.centavos;
  let comparison: ComparisonQuote | undefined;
  if (compare) {
    const search = retailerSearch(config);
    if (!search.enabled.coto) {
      comparison = emptyComparison('other_disabled');
    } else {
      try {
        const { rows } = await compareDiaToCoto(
          lines.map((l) => ({ skuId: l.skuId, name: l.name, quantity: l.quantity, lineTotal: l.lineTotal })),
          location.postalCode,
        );
        const totals = comparisonTotals(rows);
        const feeBasis: FeeBasis = totals.feeCentavos === 0 && !rows.some(countsTowardFee) ? 'no_refs' : 'gap';
        comparison = {
          ...totals,
          rows,
          feeBasis,
          feeUsdCents: feeUsdFrom(totals.feeCentavos, (centavos) => arsToUsdCents(centavos, rate.arsPerUsd, 0)),
        };
      } catch (err) {
        // Compare fail / timeout → fee 0, still payable (not 503).
        const name = err instanceof Error ? err.name : 'error';
        const code =
          err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[checkout] compare failed; fee 0', name, code, msg);
        const basis: FeeBasis = /abort|timeout/i.test(msg) ? 'timeout' : 'compare_failed';
        comparison = emptyComparison(basis);
      }
    }
  }
  const basketCents = arsToUsdCents(totalCentavos as never, rate.arsPerUsd, buffer()) as unknown as number;
  const cents = manual ? SERVICE_FEE_CENTS : basketCents + (comparison?.feeUsdCents ?? 0);
  const nonce = newOrderId();
  const orderId = manual ? await serviceOrderId(user.address, nonce) : toHex(nonce);
  const units = manual ? SERVICE_FEE_UNITS : centsToUnits(Math.round(cents)).toString();
  const manualFields = manual ? {
    checkoutKind: MANUAL_KIND, orderNonce: toHex(nonce),
    manual: { preparation: 'queued' as const, purchase: 'not_started' as const,
      preparedAt: null, viewerExpiresAt: null, sessionActive: false, sequence: 0 },
  } : {};
  const hash = currentHash;
  const handoffUrl =
    typeof body.handoffUrl === 'string' && /^https:\/\//.test(body.handoffUrl) ? body.handoffUrl : null;

  const path = checkoutPath ?? (compare ? 'dual' : undefined);
  await checkoutStore().set({
    ...manualFields,
    orderId,
    buyer: user.address,
    amount: units,
    amountCents: cents,
    basketHash: hash,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    shippingCentavos: shipping.centavos,
    postalCode: location.postalCode,
    totalDisplay: cart.total.display,
    retailer: cart.retailer,
    lines: lines.map((l) => ({ name: l.name, skuId: l.skuId, quantity: l.quantity, lineTotal: l.lineTotal.display })),
    handoffUrl,
    createdAt: Date.now(),
    mode,
    ...(manualFlow ? { manualFlow } : {}),
    ...(comparison ? { comparison } : {}),
    ...(path ? { checkoutPath: path } : {}),
  });

  const res: QuoteResponse = {
    ...(manual ? { checkoutKind: MANUAL_KIND, orderNonce: toHex(nonce),
      feeReleaseBasis: 'checkout_prepared' as const, viewerDurationSecs: VIEWER_SECONDS,
      ...(manualFlow ? { manualFlow } : {}) } : {}),
    orderId,
    amount: units,
    amountCents: cents,
    amountDisplay: (cents / 100).toFixed(2),
    basketHash: hash,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    subtotalCentavos: cart.total.centavos,
    shippingCentavos: shipping.centavos,
    totalCentavos,
    postalCode: location.postalCode,
    postalSource: saved ? 'profile' : 'chat',
    chatPostalCode: chatPostal ?? null,
    programId: contractIds(DEFAULT_NETWORK).escrowId,
    usdcMint: contractIds(DEFAULT_NETWORK).usdcId,
    mode,
    ...(comparison ? { comparison } : {}),
    ...(path ? { checkoutPath: path } : {}),
  };
  return Response.json(res);
}

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const pesos = (centavos: number) => ARS.format(centavos / 100);

type AcceptedAlt = { diaSkuId: string; cotoId: string };
type CheckoutPath = 'solo_dia' | 'solo_coto' | 'dual';

function parseAccepted(raw: unknown): AcceptedAlt[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  const out: AcceptedAlt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const diaSkuId = (item as { diaSkuId?: unknown }).diaSkuId;
    const cotoId = (item as { cotoId?: unknown }).cotoId;
    if (typeof diaSkuId === 'string' && diaSkuId && typeof cotoId === 'string' && cotoId) {
      out.push({ diaSkuId, cotoId });
    }
  }
  return out;
}

function parseCheckoutPath(raw: unknown): CheckoutPath | undefined {
  return raw === 'solo_dia' || raw === 'solo_coto' || raw === 'dual' ? raw : undefined;
}

function emptyComparison(feeBasis: FeeBasis): ComparisonQuote {
  return {
    diaSubtotalCentavos: 0,
    otherSubtotalCentavos: 0,
    savingsCentavos: 0,
    feeCentavos: 0,
    feeUsdCents: 0,
    rows: [],
    feeBasis,
  };
}

/**
 * Mock pay for accepted Coto alternativas of a Día basket.
 * The client total is ignored. Shipping is zero. Fee is 20% of the gap vs
 * the Día seed lines (may be 0). The hash is the server-built lines.
 */
async function quoteCotoDemo(
  buyer: string,
  cart: Cart,
  locationInput: unknown,
  accepted: AcceptedAlt[] | null,
  checkoutPath: CheckoutPath,
): Promise<Response> {
  if (cart.retailer !== 'dia') {
    return Response.json({ error: 'Ese súper no se puede pagar desde acá.' }, { status: 400 });
  }
  const lines = cart.lines.filter((l) => l.available && l.quantity > 0);
  if (lines.length === 0) return Response.json({ error: 'El changuito está vacío.' }, { status: 400 });

  const config = await getConfig();
  const flags = await sandboxFlags();
  const manual = !flags.mock && (await manualMember(buyer)) && flagOn(config, 'manual_checkout_enabled');
  const mode = checkoutMode({ mock: flags.mock, manual });
  if (!flagOn(config, 'chat_dual_checkout_demo') || mode !== 'mock' || manual) {
    return Response.json({ error: 'Ese súper no se puede pagar desde acá.' }, { status: 400 });
  }
  const search = retailerSearch(config);
  if (!search.enabled.coto) {
    return Response.json({ error: 'Ese súper no se puede pagar desde acá.' }, { status: 400 });
  }

  let saved: string | undefined;
  try {
    saved = (await getProfile(buyer))?.postcode;
  } catch (err) {
    console.warn('[checkout] profile unreadable for quote', err instanceof Error ? err.name : err);
  }
  const chatPostal = isLocation(locationInput) ? locationInput.postalCode : undefined;
  const location = saved
    ? { ...(isLocation(locationInput) ? locationInput : {}), postalCode: saved }
    : locationInput;
  if (!isLocation(location)) {
    return Response.json({ error: 'Falta tu código postal. Contale al chat dónde estás y volvé a intentar.' }, { status: 400 });
  }

  const override = Number(process.env.ARS_PER_USD);
  let rate;
  try {
    rate = await quoteRate(Number.isFinite(override) && override > 0 ? { override } : {});
  } catch (e) {
    console.warn('[checkout] quote failed', e instanceof Error ? e.message : String(e));
    return Response.json({ error: 'No pudimos cotizar el envío o el cambio. Probá de nuevo en un rato.' }, { status: 503 });
  }

  // Accepted ids are required. The server never defaults to every similar.
  if (!accepted || accepted.length === 0) {
    return Response.json({ error: 'Elegí al menos una alternativa de Coto.' }, { status: 400 });
  }

  let rows: ComparisonRow[];
  let feeBasis: FeeBasis = 'gap';
  try {
    const compared = await compareDiaToCoto(
      lines.map((l) => ({ skuId: l.skuId, name: l.name, quantity: l.quantity, lineTotal: l.lineTotal })),
      location.postalCode,
    );
    const want = new Set(accepted.map((a) => `${a.diaSkuId}:${a.cotoId}`));
    rows = compared.rows.filter(
      (row) => countsTowardFee(row) && row.coto && want.has(`${row.skuId}:${row.coto.id}`),
    );
    if (rows.length === 0) {
      return Response.json({ error: 'Elegí al menos una alternativa de Coto.' }, { status: 400 });
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error';
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[checkout] coto quote failed', name, code, msg);
    return Response.json({ error: 'No pudimos cotizar Coto. Probá de nuevo en un rato.' }, { status: 503 });
  }

  const serverCart = cotoServerCart(cart.cartId, rows);
  if (serverCart.lines.length === 0 || serverCart.total.centavos <= 0) {
    return Response.json({ error: 'El changuito está vacío.' }, { status: 400 });
  }
  const totals = comparisonTotals(rows);
  const feeUsdCents = feeUsdFrom(totals.feeCentavos, (centavos) => arsToUsdCents(centavos, rate.arsPerUsd, 0));
  const basketCents = arsToUsdCents(serverCart.total.centavos as never, rate.arsPerUsd, buffer()) as unknown as number;
  const cents = basketCents + feeUsdCents;
  const nonce = newOrderId();
  const orderId = toHex(nonce);
  const units = centsToUnits(Math.round(cents)).toString();
  const hash = toHex(await basketHash(serverCart));
  const comparison: ComparisonQuote = {
    ...totals,
    rows,
    feeUsdCents,
    feeBasis: totals.feeCentavos === 0 && feeBasis === 'gap' && !rows.some(countsTowardFee) ? 'no_refs' : feeBasis,
  };

  await checkoutStore().set({
    orderId,
    buyer,
    amount: units,
    amountCents: cents,
    basketHash: hash,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    shippingCentavos: 0,
    postalCode: location.postalCode,
    totalDisplay: serverCart.total.display,
    retailer: 'coto',
    lines: serverCart.lines.map((l) => ({ name: l.name, skuId: l.skuId, quantity: l.quantity, lineTotal: l.lineTotal.display })),
    handoffUrl: null,
    createdAt: Date.now(),
    mode: 'mock',
    comparison,
    checkoutPath,
  });

  const res: QuoteResponse = {
    orderId,
    amount: units,
    amountCents: cents,
    amountDisplay: (cents / 100).toFixed(2),
    basketHash: hash,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    arsPerUsd: rate.arsPerUsd,
    rateSource: rate.source,
    subtotalCentavos: serverCart.total.centavos,
    shippingCentavos: 0,
    totalCentavos: serverCart.total.centavos,
    postalCode: location.postalCode,
    postalSource: saved ? 'profile' : 'chat',
    chatPostalCode: chatPostal ?? null,
    programId: contractIds(DEFAULT_NETWORK).escrowId,
    usdcMint: contractIds(DEFAULT_NETWORK).usdcId,
    mode: 'mock',
    comparison,
    checkoutPath,
  };
  return Response.json(res);
}

/** Accepted available Coto lines only. The Día total never enters the hash. */
function cotoServerCart(diaCartId: string, rows: ComparisonRow[]): Cart {
  const lines: CartLine[] = rows.map((row, index) => {
    const offer = row.coto!;
    const unit = row.quantity > 0 ? Math.round(offer.lineCentavos / row.quantity) : offer.lineCentavos;
    return {
      index,
      skuId: offer.id,
      name: offer.name,
      quantity: row.quantity,
      sellerId: 'coto',
      unitPrice: { centavos: unit, display: pesos(unit) },
      lineTotal: { centavos: offer.lineCentavos, display: pesos(offer.lineCentavos) },
      available: true,
    };
  });
  const total = lines.reduce((sum, line) => sum + line.lineTotal.centavos, 0);
  return {
    retailer: 'coto',
    cartId: `coto:${diaCartId}`,
    lines,
    total: { centavos: total, display: pesos(total) },
    messages: [],
  };
}
