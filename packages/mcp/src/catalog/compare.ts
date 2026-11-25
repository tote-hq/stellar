/**
 * Quote one Día basket against the Coto catalog.
 * Identifiers in, prices from the two sources. No cart, no checkout on Coto.
 * A lookup that fails rejects the whole basket: a partial quote would understate the fee.
 */
import { getAdapter } from '../adapters/registry.js';
import type { Product } from '../types.js';
import { CotoCatalog, discoverPublicKey } from './coto.js';
import { matchDiaToCoto, type CotoSearcher, type MatchConfidence } from './match.js';

export interface CompareLine {
  skuId: string;
  name: string;
  quantity: number;
  lineTotal: { centavos: number };
}

/** Reads EAN and brand. The cart line does not carry either. */
export interface DiaCatalog {
  getProduct(skuId: string): Promise<Pick<Product, 'brand' | 'ean'> | null>;
}

export interface CompareCoto {
  id: string;
  name: string;
  shelfCentavos: number;
  lineCentavos: number;
  available: boolean;
}

export interface CompareRow {
  skuId: string;
  name: string;
  quantity: number;
  diaLineCentavos: number;
  confidence: MatchConfidence;
  coto?: CompareCoto;
}

/** EAN matches over lines. `brandSizeMatches` is reported and is not part of the rate. */
export interface CompareStats {
  lines: number;
  eanMatches: number;
  brandSizeMatches: number;
  none: number;
  matchRate: number;
  durationMs: number;
}

export interface CompareRunOpts {
  /** Optional deadline. #103 aborts a card that has already waited 10s. */
  signal?: AbortSignal;
}

/** How many Día product reads may be in flight. Coto stays on its own queue. */
const DIA_PREFETCH = 4;

function assertLine(line: CompareLine): void {
  if (!line.skuId || !line.name) throw new Error('dia line missing identity');
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('dia line quantity');
  if (!Number.isSafeInteger(line.lineTotal?.centavos) || line.lineTotal.centavos < 0) {
    throw new Error('dia line total');
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(limit, 1), items.length);
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }
  if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

type DiaPrefetch =
  | { ok: true; product: Pick<Product, 'brand' | 'ean'> }
  | { ok: false; error: unknown };

async function prefetchDia(
  line: CompareLine,
  dia: DiaCatalog,
  signal?: AbortSignal,
): Promise<DiaPrefetch> {
  throwIfAborted(signal);
  try {
    assertLine(line);
    const product = await dia.getProduct(line.skuId);
    if (!product) return { ok: false, error: new Error('dia product missing') };
    return { ok: true, product };
  } catch (error) {
    return { ok: false, error };
  }
}

async function compareLine(
  line: CompareLine,
  product: Pick<Product, 'brand' | 'ean'>,
  coto: CotoSearcher,
): Promise<CompareRow> {
  const asProduct: Product = {
    skuId: line.skuId,
    productId: line.skuId,
    name: line.name,
    brand: product.brand,
    ean: product.ean,
    sellerId: '1',
    price: { centavos: line.lineTotal.centavos, display: '' },
    available: true,
  };
  const found = await matchDiaToCoto(asProduct, coto);
  const row: CompareRow = {
    skuId: line.skuId,
    name: line.name,
    quantity: line.quantity,
    diaLineCentavos: line.lineTotal.centavos,
    confidence: found.confidence,
  };
  if (!found.match || found.confidence === 'none') return row;

  const shelfCentavos = found.match.shelfPrice.centavos;
  const lineCentavos = shelfCentavos * line.quantity;
  if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos < 0 || !Number.isSafeInteger(lineCentavos)) {
    throw new Error('coto line total');
  }
  row.coto = {
    id: found.match.id,
    name: found.match.name,
    shelfCentavos,
    lineCentavos,
    available: found.match.available,
  };
  return row;
}

export function compareStats(rows: readonly CompareRow[], durationMs: number): CompareStats {
  let eanMatches = 0;
  let brandSizeMatches = 0;
  let none = 0;
  for (const row of rows) {
    if (row.confidence === 'ean') eanMatches += 1;
    else if (row.confidence === 'brand_size_unit') brandSizeMatches += 1;
    else none += 1;
  }
  const lines = rows.length;
  return {
    lines,
    eanMatches,
    brandSizeMatches,
    none,
    matchRate: lines === 0 ? 0 : eanMatches / lines,
    durationMs,
  };
}

/**
 * One row per available Día line. `coto.lineCentavos` is the shelf times quantity.
 * Brand + size is returned on the row and is not a high-confidence match.
 * Día products are read at most four at a time. Row order is the input order.
 * The first Día failure, in that order, rejects the basket before any Coto call.
 */
export async function compareBasket(
  lines: readonly CompareLine[],
  dia: DiaCatalog,
  coto: CotoSearcher,
  signal?: AbortSignal,
): Promise<CompareRow[]> {
  throwIfAborted(signal);
  const prefetched = await mapPool(lines, DIA_PREFETCH, (line) => prefetchDia(line, dia, signal));
  const products: Array<Pick<Product, 'brand' | 'ean'>> = [];
  for (const hit of prefetched) {
    if (!hit.ok) throw hit.error;
    products.push(hit.product);
  }
  throwIfAborted(signal);
  const rows: CompareRow[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    throwIfAborted(signal);
    rows.push(await compareLine(lines[i] as CompareLine, products[i] as Pick<Product, 'brand' | 'ean'>, coto));
  }
  return rows;
}

/** Día adapter lookup for a postal code. One region resolution for the whole basket. */
export function diaLookup(postalCode: string): DiaCatalog {
  const adapter = getAdapter('dia');
  let location: ReturnType<typeof adapter.resolveLocation> | undefined;
  return {
    getProduct(skuId: string) {
      location ??= adapter.resolveLocation(postalCode);
      return location.then((ctx) => adapter.getProduct(skuId, ctx));
    },
  };
}

/** The catalog searcher. Not a retailer: it cannot cart or check out. */
export function cotoSearcher(): CotoSearcher {
  return new CotoCatalog();
}

/**
 * The quote route, the probe and the chat card all enter here.
 * A lookup failure rejects. `opts` is omitted by the quote route, which keeps
 * its own 503 and never prices a fee of 0.
 */
export async function compareDiaToCoto(
  lines: readonly CompareLine[],
  postalCode: string,
  opts?: CompareRunOpts,
): Promise<{ rows: CompareRow[]; stats: CompareStats }> {
  const started = Date.now();
  // The storefront key overlaps the Día prefetch. Searches join the same flight.
  void discoverPublicKey().catch(() => undefined);
  const rows = await compareBasket(lines, diaLookup(postalCode), cotoSearcher(), opts?.signal);
  return { rows, stats: compareStats(rows, Date.now() - started) };
}

export { PROBE_BASKET, PROBE_POSTAL } from './probe-basket.js';
export {
  assembleSearchCompare,
  lookupCoto,
  searchCompare,
} from './search-compare.js';
export type {
  CotoLookup,
  SearchCompareResult,
  SearchCompareStatus,
  SearchHit,
  SearchPair,
} from './search-compare.js';
export type { CotoSearcher } from './match.js';
export type { CatalogItem } from './coto.js';
export { compareForCard } from './compare-card.js';
