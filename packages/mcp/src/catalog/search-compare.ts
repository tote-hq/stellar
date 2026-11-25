/**
 * One shopper query, both catalogs.
 *
 * Día products are already in hand (the VTEX search). Coto is one Constructor
 * query. The gap is the first Día hit that `pickMatch` accepts (`ean` or
 * `brand_size_unit`) where both sides are available. A failed Coto lookup
 * contributes no rows and no zero price.
 */
import type { Product } from '../types.js';
import type { CatalogItem } from './coto.js';
import { pickMatch, type CotoSearcher } from './match.js';

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

export interface SearchCompareResult {
  status: SearchCompareStatus;
  coto: SearchHit[];
  pair?: SearchPair;
  gapCentavos?: number;
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

/** Pure. `diaFailed` wins the status even when Coto returned rows. */
export function assembleSearchCompare(args: {
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

  const result: SearchCompareResult = { status, coto: args.coto.ok ? hits : [] };
  if (args.diaFailed || !args.coto.ok) return result;

  const candidates = args.coto.items.filter(
    (item) => item.available && item.shelfPrice.centavos > 0,
  );
  for (const dia of args.diaProducts) {
    if (!dia.available || !Number.isSafeInteger(dia.price.centavos) || dia.price.centavos <= 0) continue;
    const matched = pickMatch({ name: dia.name, brand: dia.brand, ean: dia.ean }, candidates);
    if (!matched.match || matched.confidence === 'none') continue;
    const cotoCentavos = matched.match.shelfPrice.centavos;
    if (!Number.isSafeInteger(cotoCentavos) || cotoCentavos <= 0) continue;
    result.pair = {
      diaSkuId: dia.skuId,
      diaCentavos: dia.price.centavos,
      cotoId: matched.match.id,
      cotoCentavos,
      confidence: matched.confidence === 'ean' ? 'ean' : 'brand_size_unit',
    };
    result.gapCentavos = Math.abs(dia.price.centavos - cotoCentavos);
    break;
  }
  return result;
}

export async function lookupCoto(
  query: string,
  coto: CotoSearcher,
  signal?: AbortSignal,
): Promise<CotoLookup> {
  try {
    if (signal?.aborted) return { ok: false, reason: 'timed_out' };
    const items = await coto.search(query, { limit: 12 });
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
    diaProducts,
    diaFailed: opts.diaFailed === true,
    coto,
  });
}
