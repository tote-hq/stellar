/**
 * One shopper query, both catalogs.
 *
 * Día products are already in hand (the VTEX search). Coto is one Constructor
 * query. Each side's card is the cheapest available hit of this query's food
 * type. The gap is set only when those two picks are the same product
 * (`ean` or brand + pack size). A similar pair is labeled and has no gap.
 * A failed lookup contributes no rows and no zero price.
 */
import type { Product } from '../types.js';
import type { CatalogItem } from './coto.js';
import { ofQueryType, typeScore } from './food-type.js';
import { pickSameProduct, type CotoSearcher } from './match.js';

export type SearchCompareStatus = 'ok' | 'coto_empty' | 'coto_error' | 'coto_timed_out' | 'dia_error';

export interface SearchHit {
  id: string;
  name: string;
  shelfCentavos: number;
  available: boolean;
  ean?: string;
  brand?: string;
  url?: string;
  imageUrl?: string;
}

export interface SearchPair {
  diaSkuId: string;
  diaCentavos: number;
  cotoId: string;
  cotoCentavos: number;
  /** Only `ean` or `brand_size_unit`. `none` never becomes a pair. */
  confidence: 'ean' | 'brand_size_unit';
}

/** The one product a chain shows for this query. Prices come from the catalog. */
export interface TypedPick {
  id: string;
  name: string;
  shelfCentavos: number;
  available: boolean;
  ean?: string;
  brand?: string;
  imageUrl?: string;
  unitMultiplier?: number;
  measurementUnit?: string;
}

export type SearchMatch = 'same' | 'similar' | 'none';

export interface SearchCompareResult {
  status: SearchCompareStatus;
  coto: SearchHit[];
  pair?: SearchPair;
  gapCentavos?: number;
  /** `same` only when `pair` is set. `similar` is both picks and no gap. */
  match: SearchMatch;
  diaPick?: TypedPick;
  cotoPick?: TypedPick;
}

export type CotoLookup =
  | { ok: true; items: readonly CatalogItem[] }
  | { ok: false; reason: 'error' | 'timed_out' };

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function toSearchHit(item: CatalogItem): SearchHit | null {
  const shelfCentavos = item.shelfPrice.centavos;
  if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos <= 0) return null;
  if (!item.id || !item.name) return null;
  const hit: SearchHit = {
    id: item.id,
    name: item.name,
    shelfCentavos,
    available: item.available,
  };
  if (item.ean) hit.ean = item.ean;
  if (item.brand) hit.brand = item.brand;
  if (item.url) hit.url = item.url;
  if (item.imageUrl) hit.imageUrl = item.imageUrl;
  return hit;
}

/**
 * Cheapest item in the highest `typeScore` tier. A tie on the score keeps
 * today's rule: the lowest price, and a price tie keeps catalog order.
 */
function bestOfType<T extends { name: string; brand?: string }>(
  items: readonly T[],
  query: string,
  priceOf: (item: T) => number,
): T | undefined {
  let bestScore = 0;
  for (const item of items) {
    const score = typeScore(query, item);
    if (score > bestScore) bestScore = score;
  }
  if (bestScore <= 0) return undefined;
  const tier: T[] = [];
  for (const item of items) {
    if (typeScore(query, item) === bestScore) tier.push(item);
  }
  return cheapest(tier, priceOf);
}

function cheapest<T>(items: readonly T[], priceOf: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestPrice = 0;
  for (const item of items) {
    const price = priceOf(item);
    if (!Number.isSafeInteger(price) || price <= 0) continue;
    if (!best || price < bestPrice) {
      best = item;
      bestPrice = price;
    }
  }
  return best;
}

function diaAvailable(product: Product): boolean {
  return (
    product.available === true &&
    Boolean(product.skuId) &&
    Boolean(product.name) &&
    Number.isSafeInteger(product.price?.centavos) &&
    product.price.centavos > 0
  );
}

function cotoAvailable(item: CatalogItem): boolean {
  return item.available === true && Number.isSafeInteger(item.shelfPrice.centavos) && item.shelfPrice.centavos > 0;
}

function diaToPick(product: Product): TypedPick {
  const pick: TypedPick = {
    id: product.skuId,
    name: product.name,
    shelfCentavos: product.price.centavos,
    available: true,
  };
  if (product.ean) pick.ean = product.ean;
  if (product.brand) pick.brand = product.brand;
  if (product.imageUrl) pick.imageUrl = product.imageUrl;
  if (typeof product.unitMultiplier === 'number' && product.unitMultiplier > 0 && product.measurementUnit) {
    pick.unitMultiplier = product.unitMultiplier;
    pick.measurementUnit = product.measurementUnit;
  }
  return pick;
}

function cotoToPick(item: CatalogItem): TypedPick {
  const pick: TypedPick = {
    id: item.id,
    name: item.name,
    shelfCentavos: item.shelfPrice.centavos,
    available: true,
  };
  if (item.ean) pick.ean = item.ean;
  if (item.brand) pick.brand = item.brand;
  if (item.imageUrl) pick.imageUrl = item.imageUrl;
  return pick;
}

/**
 * Pure. `diaFailed` wins the status even when Coto returned rows.
 * `query` is the type. Each pick is the cheapest available hit in the best
 * `typeScore` tier for that side. When every hit scores the same, that is
 * the cheapest. A price tie keeps catalog order. The gap is the two picks,
 * and only when they are the same product.
 * `diaQuery` and `cotoQuery` type one side against a wider term. Absent,
 * both sides use `query`.
 */
export function assembleSearchCompare(args: {
  query: string;
  diaQuery?: string;
  cotoQuery?: string;
  diaProducts: readonly Product[];
  diaFailed: boolean;
  coto: CotoLookup;
}): SearchCompareResult {
  const hits = args.coto.ok
    ? args.coto.items.map(toSearchHit).filter((hit): hit is SearchHit => hit !== null)
    : [];
  let status: SearchCompareStatus = 'ok';
  if (args.diaFailed) status = 'dia_error';
  else if (!args.coto.ok && args.coto.reason === 'timed_out') status = 'coto_timed_out';
  else if (!args.coto.ok) status = 'coto_error';
  else if (hits.length === 0) status = 'coto_empty';

  const result: SearchCompareResult = { status, coto: args.coto.ok ? hits : [], match: 'none' };

  const diaType = args.diaQuery ?? args.query;
  const cotoType = args.cotoQuery ?? args.query;
  const typedDia = args.diaFailed
    ? []
    : args.diaProducts.filter((product) => diaAvailable(product) && ofQueryType(diaType, product));
  const typedCoto = args.coto.ok
    ? args.coto.items.filter((item) => cotoAvailable(item) && Boolean(item.id) && Boolean(item.name) && ofQueryType(cotoType, item))
    : [];

  const cotoPick = bestOfType(typedCoto, cotoType, (item) => item.shelfPrice.centavos);
  if (cotoPick) result.cotoPick = cotoToPick(cotoPick);

  if (cotoPick) {
    const same = pickSameProduct(
      { name: cotoPick.name, brand: cotoPick.brand, ean: cotoPick.ean, size: cotoPick.size },
      typedDia,
    );
    if (same.match && same.confidence !== 'none') {
      result.diaPick = diaToPick(same.match);
      result.match = 'same';
      const cotoCentavos = cotoPick.shelfPrice.centavos;
      result.pair = {
        diaSkuId: same.match.skuId,
        diaCentavos: same.match.price.centavos,
        cotoId: cotoPick.id,
        cotoCentavos,
        confidence: same.confidence === 'ean' ? 'ean' : 'brand_size_unit',
      };
      result.gapCentavos = Math.abs(same.match.price.centavos - cotoCentavos);
      return result;
    }
    const diaPick = bestOfType(typedDia, diaType, (product) => product.price.centavos);
    if (diaPick) {
      result.diaPick = diaToPick(diaPick);
      result.match = 'similar';
    }
    return result;
  }

  const diaPick = bestOfType(typedDia, diaType, (product) => product.price.centavos);
  if (diaPick) result.diaPick = diaToPick(diaPick);
  return result;
}

export async function lookupCoto(
  query: string,
  coto: CotoSearcher,
  signal?: AbortSignal,
  limit = 12,
): Promise<CotoLookup> {
  try {
    if (signal?.aborted) return { ok: false, reason: 'timed_out' };
    const items = await coto.search(query, { limit });
    if (signal?.aborted) return { ok: false, reason: 'timed_out' };
    return { ok: true, items };
  } catch (error) {
    return { ok: false, reason: isAbort(error) ? 'timed_out' : 'error' };
  }
}

export async function searchCompare(
  query: string,
  diaProducts: readonly Product[],
  opts: { coto: CotoSearcher; signal?: AbortSignal; diaFailed?: boolean },
): Promise<SearchCompareResult> {
  const coto = await lookupCoto(query, opts.coto, opts.signal);
  return assembleSearchCompare({
    query,
    diaProducts,
    diaFailed: opts.diaFailed === true,
    coto,
  });
}
