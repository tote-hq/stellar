/**
 * The Día vs Coto card draws itself.
 *
 * Día carts only. A Coto basket never runs this: the search-time card already
 * compared the chains, and a Coto order is not a Día cart with Coto links.
 * One basket, not a recommendation: after `get_cart_link`, for a Día cart
 * whose link opens that cart, and only when `chat_dual_compare` is on. The
 * model does not choose a price, a name, or a URL. A repeated fingerprint
 * re-emits the stored card and does not call Coto.
 */
import type { Cart } from '@changuito/mcp/types';

import type { CompareCard, CompareLineView, UiEvent } from '../protocol.ts';
import { cartLink } from './render-tools.ts';
import type { RenderCache } from './render-tools.ts';

const COMPARE_MS = 10_000;

export interface CompareSource {
  status: 'ok' | 'degraded' | 'timed_out';
  rows: CompareLineView[];
  matched: number;
  lines: number;
  gap?: CompareCard['gap'];
}

export type CompareFn = (
  lines: ReadonlyArray<{ skuId: string; name: string; quantity: number; lineTotal: { centavos: number } }>,
  postalCode: string,
  opts?: { signal?: AbortSignal },
) => Promise<CompareSource>;

/** Cart id plus each line's index, sku, quantity, line total, and availability. */
export function compareFingerprint(cart: Cart): string {
  const lines = cart.lines.map(
    (line) => `${line.index}:${line.skuId}:${line.quantity}:${line.lineTotal.centavos}:${line.available ? 1 : 0}`,
  );
  return [cart.cartId, ...lines].join('|');
}

export function compareSummary(card: CompareCard): string {
  const gap = card.gap ? `gapCentavos=${card.gap.gapCentavos}` : 'gap=unknown';
  return `[compare: status=${card.status} retailer=dia matched=${card.matched}/${card.lines} ${gap}]`;
}

function offerOf(row: CompareLineView): CompareLineView['coto'] {
  const coto = row.coto;
  if (!coto) return undefined;
  if (!Number.isSafeInteger(coto.shelfCentavos) || coto.shelfCentavos <= 0) return undefined;
  if (!Number.isSafeInteger(coto.lineCentavos) || coto.lineCentavos <= 0) return undefined;
  const offer: NonNullable<CompareLineView['coto']> = {
    id: coto.id,
    name: coto.name,
    shelfCentavos: coto.shelfCentavos,
    lineCentavos: coto.lineCentavos,
    available: coto.available,
  };
  if (coto.url && /^https?:\/\//i.test(coto.url)) offer.url = coto.url;
  return offer;
}

function toCard(source: CompareSource, cartId: string, handoffUrl: string): CompareCard {
  const rows = source.rows.map((row) => {
    const view: CompareLineView = {
      skuId: row.skuId,
      name: row.name,
      quantity: row.quantity,
      diaLineCentavos: row.diaLineCentavos,
      confidence: row.confidence,
    };
    const coto = offerOf(row);
    if (coto) view.coto = coto;
    return view;
  });
  const card: CompareCard = {
    status: source.status,
    cartId,
    handoffUrl,
    matched: source.matched,
    lines: source.lines,
    rows,
  };
  if (source.gap && Number.isSafeInteger(source.gap.gapCentavos) && source.gap.gapCentavos >= 0) {
    card.gap = source.gap;
  }
  return card;
}

async function liveCompare(
  lines: Parameters<CompareFn>[0],
  postalCode: string,
  opts?: { signal?: AbortSignal },
): Promise<CompareSource> {
  const { compareForCard } = await import('@changuito/mcp/compare');
  return compareForCard(lines, postalCode, opts);
}

export async function autoCompare(args: {
  cache: RenderCache;
  toolName: string;
  enabled: boolean;
  postalCode?: string;
  emit: (event: UiEvent) => void;
  compare?: CompareFn;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  if (args.toolName !== 'get_cart_link' || !args.enabled) return undefined;
  const cart = args.cache.cart;
  const handoffUrl = cartLink(args.cache);
  if (!cart || cart.retailer !== 'dia' || !handoffUrl || cart.lines.length === 0) return undefined;
  const fingerprint = compareFingerprint(cart);
  const stored = args.cache.compareResult;
  if (args.cache.compareFor === fingerprint && stored && stored.cartId === cart.cartId) {
    args.emit(compareEvent(stored, handoffUrl, args.cache.dualCheckout === true));
    return compareSummary({ ...stored, handoffUrl });
  }
  if (!args.postalCode) return undefined;

  const lines = cart.lines
    .filter((line) => line.skuId && line.name && line.quantity > 0 && Number.isSafeInteger(line.lineTotal.centavos))
    .map((line) => ({
      skuId: line.skuId,
      name: line.name,
      quantity: line.quantity,
      lineTotal: { centavos: line.lineTotal.centavos },
    }));
  if (lines.length === 0) return undefined;

  args.emit({ t: 'compare', status: 'pending', cartId: cart.cartId, handoffUrl });
  const signal = args.signal ?? AbortSignal.timeout(COMPARE_MS);
  const compare = args.compare ?? liveCompare;
  let card: CompareCard;
  try {
    card = toCard(await compare(lines, args.postalCode, { signal }), cart.cartId, handoffUrl);
  } catch (error) {
    const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
    if (aborted) {
      // Finished rows are the value compareForCard returns. A throw has
      // already dropped them; an empty card would stand in for that result
      // and, once cached, would not be compared again.
      throw error;
    }
    card = {
      status: 'degraded',
      cartId: cart.cartId,
      handoffUrl,
      matched: 0,
      lines: lines.length,
      rows: [],
    };
  }
  args.cache.compareFor = fingerprint;
  args.cache.compareResult = card;
  args.emit(compareEvent(card, handoffUrl, args.cache.dualCheckout === true));
  return compareSummary(card);
}

/** Pending and timed_out never offer Coto pay. A match on ok or degraded may. */
function compareEvent(card: CompareCard, handoffUrl: string, demo: boolean): UiEvent {
  const offer =
    demo && (card.status === 'ok' || card.status === 'degraded') && card.matched >= 1;
  return { t: 'compare', ...card, handoffUrl, ...(offer ? { checkoutDemo: true } : {}) };
}
