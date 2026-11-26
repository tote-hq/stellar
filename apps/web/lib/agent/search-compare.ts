/**
 * Search-time Día and Coto.
 *
 * The Coto lookup starts in the same turn as the Día MCP call and never gets
 * a trail row: it is in-process. Prices on the card come from the two catalogs.
 * Once a chain is chosen, only that chain is queried. The fee stays on the
 * model note for a dual search; the shopper sees it on the close table.
 * Nothing here writes a cart.
 */
import type { CotoSearcher } from '@changuito/mcp/compare';
import type { Product } from '@changuito/mcp/types';

import { feeCentavosOf } from '../checkout/compare-fee.ts';
import { mergeDiaPair } from '../checkout/coto-real.ts';
import { cheapestAvailable } from '../one-per-type.ts';
import type { SearchCompareItem, UiEvent } from '../protocol.ts';
import type { RenderCache } from './render-tools.ts';

const COTO_MS = 10_000;

const ars = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

export function chainChoiceOn(input: {
  compareOn: boolean;
  cotoEnabled: boolean;
  retailer?: string;
}): boolean {
  return input.compareOn === true && input.cotoEnabled === true && input.retailer === 'dia';
}

/** Both catalogs, and only before the shopper has picked a chain. */
export function dualSearchOn(input: {
  compareOn: boolean;
  cotoEnabled: boolean;
  retailer?: string;
  order?: string;
}): boolean {
  return chainChoiceOn(input) && input.order === undefined;
}

/** Which catalogs `search_products` may query on this turn. */
export function searchMode(input: {
  compareOn: boolean;
  cotoEnabled: boolean;
  retailer?: string;
  order?: string;
}): 'both' | 'dia' | 'coto' | 'off' {
  if (!chainChoiceOn(input)) return 'off';
  if (input.order === 'dia') return 'dia';
  if (input.order === 'coto') return 'coto';
  return 'both';
}

export function searchCompareNote(args: {
  id: string;
  dia: number;
  coto: number;
  matched: number;
  gapCentavos?: number;
  /** The one pair the fee was computed on. Armar does not add this id. */
  pair?: { diaSkuId: string; cotoId: string };
  /** The card the shopper saw. Armar adds this id, one per type. */
  pickDia?: string;
  pickCoto?: string;
  hits: ReadonlyArray<{ id: string; name: string; shelfCentavos: number; available: boolean }>;
}): string {
  const gap = args.gapCentavos === undefined ? 'gap=unknown' : `gapCentavos=${args.gapCentavos}`;
  const pair = args.pair ? ` pairDia=${args.pair.diaSkuId} pairCoto=${args.pair.cotoId}` : '';
  const pickDia = args.pickDia ? ` pickDia=${args.pickDia}` : '';
  const pickCoto = args.pickCoto ? ` pickCoto=${args.pickCoto}` : '';
  const head = `[search_compare: id=${args.id} dia=${args.dia} coto=${args.coto} matched=${args.matched} ${gap}${pair}${pickDia}${pickCoto}]`;
  const lines = args.hits
    .filter((hit) => hit.available && hit.shelfCentavos > 0)
    .map((hit) => `${hit.id} · ${hit.name} · ${ars.format(hit.shelfCentavos / 100)}`);
  return [head, ...lines].join('\n');
}

/** At most one card per chain. The candidate count stays with `recordSearch`. */
function pickedView(items: SearchCompareItem[]): SearchCompareItem[] {
  const one = cheapestAvailable(items);
  return one ? [one] : [];
}

function recordSearch(cache: RenderCache, query: string, retailer: 'dia' | 'coto', available: number): void {
  const searches = cache.searches ? [...cache.searches] : [];
  searches.push({ query, retailer, available });
  cache.searches = searches;
}

function cardItem(src: {
  id: string;
  name: string;
  shelfCentavos: number;
  available: boolean;
  brand?: string;
  imageUrl?: string;
  unitMultiplier?: number;
  measurementUnit?: string;
}): SearchCompareItem {
  const item: SearchCompareItem = {
    id: src.id,
    name: src.name,
    shelfCentavos: src.shelfCentavos,
    available: src.available,
  };
  if (src.brand) item.brand = src.brand;
  if (src.imageUrl) item.imageUrl = src.imageUrl;
  if (typeof src.unitMultiplier === 'number' && src.unitMultiplier > 0 && src.measurementUnit) {
    item.unitMultiplier = src.unitMultiplier;
    item.measurementUnit = src.measurementUnit;
  }
  return item;
}

function diaItems(products: readonly Product[]): SearchCompareItem[] {
  const items: SearchCompareItem[] = [];
  for (const product of products) {
    const shelfCentavos = product.price?.centavos;
    if (!product.available || !product.skuId || !product.name) continue;
    if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos <= 0) continue;
    items.push(
      cardItem({
        id: product.skuId,
        name: product.name,
        shelfCentavos,
        available: true,
        brand: product.brand,
        imageUrl: product.imageUrl,
        unitMultiplier: product.unitMultiplier,
        measurementUnit: product.measurementUnit,
      }),
    );
  }
  return items;
}

function cotoItems(
  hits: ReadonlyArray<{ id: string; name: string; shelfCentavos: number; available: boolean; brand?: string; imageUrl?: string }>,
): SearchCompareItem[] {
  const items: SearchCompareItem[] = [];
  for (const hit of hits) {
    if (!hit.available || hit.shelfCentavos <= 0) continue;
    items.push(
      cardItem({
        id: hit.id,
        name: hit.name,
        shelfCentavos: hit.shelfCentavos,
        available: true,
        brand: hit.brand,
        imageUrl: hit.imageUrl,
      }),
    );
  }
  return items;
}

async function liveSearcher(): Promise<CotoSearcher> {
  const { cotoSearcher } = await import('@changuito/mcp/compare');
  return cotoSearcher();
}

async function cappedLookup(query: string, searcher: CotoSearcher, ms: number) {
  const { lookupCoto } = await import('@changuito/mcp/compare');
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; reason: 'timed_out' }>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve({ ok: false, reason: 'timed_out' });
    }, ms);
  });
  try {
    return await Promise.race([lookupCoto(query, searcher, ac.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Emit `pending` and start the Coto lookup now. `finish` runs after the Día
 * tool result is in hand. The lookup is already in flight by then.
 */
export function beginDualSearch(args: {
  id: string;
  query: string;
  postalCode?: string;
  cache: RenderCache;
  emit: (event: UiEvent) => void;
  timeoutMs?: number;
  searcher?: CotoSearcher;
}): { finish(dia: { products: readonly Product[]; failed: boolean }): Promise<string> } {
  args.emit({
    t: 'search_compare',
    id: args.id,
    status: 'pending',
    query: args.query,
    ...(args.postalCode ? { postalCode: args.postalCode } : {}),
  });
  const searcher = args.searcher ? Promise.resolve(args.searcher) : liveSearcher();
  const lookup = searcher.then((ready) => cappedLookup(args.query, ready, args.timeoutMs ?? COTO_MS));

  return {
    async finish(dia) {
      const { assembleSearchCompare } = await import('@changuito/mcp/compare');
      let folded;
      try {
        const coto = await lookup;
        folded = assembleSearchCompare({
          diaProducts: dia.products,
          diaFailed: dia.failed,
          coto,
        });
      } catch {
        folded = assembleSearchCompare({
          diaProducts: dia.products,
          diaFailed: dia.failed,
          coto: { ok: false, reason: 'error' },
        });
      }

      const diaCandidates = dia.failed ? [] : diaItems(dia.products);
      const cotoCandidates = cotoItems(folded.coto);
      const diaView = pickedView(diaCandidates);
      const cotoView = pickedView(cotoCandidates);
      const feeCentavos =
        folded.gapCentavos === undefined ? undefined : feeCentavosOf(folded.gapCentavos);

      const cotoCache = { ...(args.cache.coto ?? {}) };
      for (const hit of folded.coto) {
        cotoCache[hit.id] = {
          id: hit.id,
          name: hit.name,
          shelfCentavos: hit.shelfCentavos,
          available: hit.available,
          ...(hit.ean ? { ean: hit.ean } : {}),
          ...(hit.brand ? { brand: hit.brand } : {}),
          ...(hit.url ? { url: hit.url } : {}),
          ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
        };
      }
      args.cache.coto = cotoCache;
      if (
        folded.pair &&
        (folded.pair.confidence === 'ean' || folded.pair.confidence === 'brand_size_unit') &&
        Number.isSafeInteger(folded.pair.diaCentavos) &&
        folded.pair.diaCentavos > 0
      ) {
        args.cache.diaPairs = mergeDiaPair(args.cache.diaPairs ?? [], {
          cotoId: folded.pair.cotoId,
          diaSkuId: folded.pair.diaSkuId,
          diaCentavos: folded.pair.diaCentavos,
          confidence: folded.pair.confidence,
        });
      }
      recordSearch(args.cache, args.query, 'dia', diaCandidates.length);
      recordSearch(args.cache, args.query, 'coto', cotoCandidates.length);

      args.emit({
        t: 'search_compare',
        id: args.id,
        status: folded.status,
        query: args.query,
        ...(args.postalCode ? { postalCode: args.postalCode } : {}),
        dia: diaView,
        coto: cotoView,
        ...(folded.gapCentavos === undefined ? {} : { gapCentavos: folded.gapCentavos }),
        ...(feeCentavos === undefined ? {} : { feeCentavos }),
      });

      return searchCompareNote({
        id: args.id,
        dia: diaView.length,
        coto: cotoView.length,
        matched: folded.pair ? 1 : 0,
        gapCentavos: folded.gapCentavos,
        ...(folded.pair ? { pair: folded.pair } : {}),
        ...(diaView[0] ? { pickDia: diaView[0].id } : {}),
        ...(cotoView[0] ? { pickCoto: cotoView[0].id } : {}),
        hits: [...diaView, ...cotoView],
      });
    },
  };
}

type ChainSearch = {
  finish(dia?: { products: readonly Product[]; failed: boolean }): Promise<string>;
};

/**
 * One chain, after the shopper has chosen it. Same emit and cache rules as
 * `beginDualSearch`. Día does not start a Coto lookup. Coto does not call Día.
 */
export function beginChainSearch(args: {
  chain: 'dia' | 'coto';
  id: string;
  query: string;
  postalCode?: string;
  cache: RenderCache;
  emit: (event: UiEvent) => void;
  timeoutMs?: number;
  searcher?: CotoSearcher;
}): ChainSearch {
  const chains = [args.chain] as ('dia' | 'coto')[];
  args.emit({
    t: 'search_compare',
    id: args.id,
    status: 'pending',
    query: args.query,
    ...(args.postalCode ? { postalCode: args.postalCode } : {}),
    chains,
  });

  if (args.chain === 'coto') {
    const searcher = args.searcher ? Promise.resolve(args.searcher) : liveSearcher();
    const lookup = searcher.then((ready) => cappedLookup(args.query, ready, args.timeoutMs ?? COTO_MS));
    return {
      async finish() {
        const { assembleSearchCompare } = await import('@changuito/mcp/compare');
        let folded;
        try {
          folded = assembleSearchCompare({
            diaProducts: [],
            diaFailed: false,
            coto: await lookup,
          });
        } catch {
          folded = assembleSearchCompare({
            diaProducts: [],
            diaFailed: false,
            coto: { ok: false, reason: 'error' },
          });
        }
        const cotoCandidates = cotoItems(folded.coto);
        const cotoView = pickedView(cotoCandidates);
        const cotoCache = { ...(args.cache.coto ?? {}) };
        for (const hit of folded.coto) {
          cotoCache[hit.id] = {
            id: hit.id,
            name: hit.name,
            shelfCentavos: hit.shelfCentavos,
            available: hit.available,
            ...(hit.ean ? { ean: hit.ean } : {}),
            ...(hit.brand ? { brand: hit.brand } : {}),
            ...(hit.url ? { url: hit.url } : {}),
            ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
          };
        }
        args.cache.coto = cotoCache;
        recordSearch(args.cache, args.query, 'coto', cotoCandidates.length);
        args.emit({
          t: 'search_compare',
          id: args.id,
          status: folded.status,
          query: args.query,
          ...(args.postalCode ? { postalCode: args.postalCode } : {}),
          dia: [],
          coto: cotoView,
          chains,
        });
        return searchCompareNote({
          id: args.id,
          dia: 0,
          coto: cotoView.length,
          matched: 0,
          ...(cotoView[0] ? { pickCoto: cotoView[0].id } : {}),
          hits: cotoView,
        });
      },
    };
  }

  return {
    async finish(dia) {
      const failed = dia?.failed === true;
      const diaCandidates = failed || !dia ? [] : diaItems(dia.products);
      const diaView = pickedView(diaCandidates);
      recordSearch(args.cache, args.query, 'dia', diaCandidates.length);
      args.emit({
        t: 'search_compare',
        id: args.id,
        status: failed ? 'dia_error' : 'ok',
        query: args.query,
        ...(args.postalCode ? { postalCode: args.postalCode } : {}),
        dia: diaView,
        coto: [],
        chains,
      });
      return searchCompareNote({
        id: args.id,
        dia: diaView.length,
        coto: 0,
        matched: 0,
        ...(diaView[0] ? { pickDia: diaView[0].id } : {}),
        hits: diaView,
      });
    },
  };
}
