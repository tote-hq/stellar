/**
 * Match one Día product to a Coto catalog row.
 * EAN first, then brand + pack size + unit. Brand alone or the name alone
 * is not a match. Día's `unitMultiplier` and `measurementUnit` are not read.
 */
import type { Product } from '../types.js';
import type { CatalogItem } from './coto.js';
import {
  nameWithoutSize,
  normalizeBrand,
  normalizeEan,
  sizeFromName,
  sizesEqual,
  type NameSize,
} from './normalize.js';

export type MatchConfidence = 'ean' | 'brand_size_unit' | 'none';

export interface MatchResult {
  match: CatalogItem | null;
  confidence: MatchConfidence;
}

export interface DiaMatchInput {
  name: string;
  brand?: string;
  ean?: string;
}

export interface CotoSearcher {
  search(query: string, opts?: { limit?: number }): Promise<CatalogItem[]>;
}

const EAN_LIMIT = 8;
const BRAND_LIMIT = 20;

function tokens(value: string): Set<string> {
  const parts = normalizeBrand(nameWithoutSize(value))
    .split(' ')
    .filter((token) => token.length > 1);
  return new Set(parts);
}

/** Shared name tokens, after the pack size is removed. Higher is closer. */
export function scoreCandidate(diaName: string, candidateName: string): number {
  const wanted = tokens(diaName);
  if (!wanted.size) return 0;
  let score = 0;
  for (const token of tokens(candidateName)) {
    if (wanted.has(token)) score += 1;
  }
  return score;
}

function bestByScore(diaName: string, items: readonly CatalogItem[]): CatalogItem {
  let best = items[0] as CatalogItem;
  let bestScore = scoreCandidate(diaName, best.name);
  for (const item of items.slice(1)) {
    const score = scoreCandidate(diaName, item.name);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pure match against candidates already in hand.
 * An exact EAN wins over a brand + size hit. No brand, or a different
 * canonical size or unit, is `none`.
 */
export function pickMatch(dia: DiaMatchInput, candidates: readonly CatalogItem[]): MatchResult {
  const ean = normalizeEan(dia.ean);
  if (ean) {
    const exact = candidates.filter((item) => normalizeEan(item.ean) === ean);
    if (exact.length === 1) return { match: exact[0] ?? null, confidence: 'ean' };
    if (exact.length > 1) return { match: bestByScore(dia.name, exact), confidence: 'ean' };
  }

  const brand = normalizeBrand(dia.brand ?? '');
  const diaSize = sizeFromName(dia.name);
  if (!brand || !diaSize) return { match: null, confidence: 'none' };

  const same = candidates.filter((item) => {
    const itemBrand = normalizeBrand(item.brand ?? '');
    if (!itemBrand || itemBrand !== brand) return false;
    if (!item.size || !sizesEqual(diaSize, item.size)) return false;
    return true;
  });
  if (!same.length) return { match: null, confidence: 'none' };
  return { match: bestByScore(dia.name, same), confidence: 'brand_size_unit' };
}

export interface SameProductRef {
  name: string;
  brand?: string;
  ean?: string;
  size?: NameSize | null;
}

function sizeOf(item: SameProductRef): NameSize | null {
  return item.size ?? sizeFromName(item.name);
}

function bestNamed<T extends { name: string }>(refName: string, items: readonly T[]): T {
  let best = items[0] as T;
  let bestScore = scoreCandidate(refName, best.name);
  for (const item of items.slice(1)) {
    const score = scoreCandidate(refName, item.name);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The same rule as `pickMatch`, in either direction.
 * EAN first, then brand plus the canonical pack size. A name on its own
 * is not a match. `pickMatch` itself is unchanged.
 */
export function pickSameProduct<T extends SameProductRef>(
  ref: SameProductRef,
  candidates: readonly T[],
): { match: T | null; confidence: MatchConfidence } {
  const ean = normalizeEan(ref.ean);
  if (ean) {
    const exact = candidates.filter((item) => normalizeEan(item.ean) === ean);
    if (exact.length === 1) return { match: exact[0] ?? null, confidence: 'ean' };
    if (exact.length > 1) return { match: bestNamed(ref.name, exact), confidence: 'ean' };
  }

  const brand = normalizeBrand(ref.brand ?? '');
  const refSize = sizeOf(ref);
  if (!brand || !refSize) return { match: null, confidence: 'none' };

  const same = candidates.filter((item) => {
    const itemBrand = normalizeBrand(item.brand ?? '');
    if (!itemBrand || itemBrand !== brand) return false;
    const itemSize = sizeOf(item);
    if (!itemSize || !sizesEqual(refSize, itemSize)) return false;
    return true;
  });
  if (!same.length) return { match: null, confidence: 'none' };
  return { match: bestNamed(ref.name, same), confidence: 'brand_size_unit' };
}

function brandQuery(dia: DiaMatchInput): string {
  const brand = normalizeBrand(dia.brand ?? '');
  return [brand, nameWithoutSize(dia.name)].join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Search Coto for `dia`. EAN first. With no exact EAN hit, search by
 * normalized brand plus the name without its size, and keep a row only when
 * the brand and the canonical pack size and unit all agree.
 */
export async function matchDiaToCoto(dia: Product, coto: CotoSearcher): Promise<MatchResult> {
  const ean = normalizeEan(dia.ean);
  if (ean) {
    const hits = await coto.search(ean, { limit: EAN_LIMIT });
    const exact = pickMatch(dia, hits);
    if (exact.confidence === 'ean') return exact;
  }

  const brand = normalizeBrand(dia.brand ?? '');
  const size = sizeFromName(dia.name);
  if (!brand || !size) return { match: null, confidence: 'none' };
  const query = brandQuery(dia);
  if (!query) return { match: null, confidence: 'none' };
  const hits = await coto.search(query, { limit: BRAND_LIMIT });
  return pickMatch(dia, hits);
}
