/**
 * Search-time Día and Coto.
 *
 * The Coto lookup starts in the same turn as the Día MCP call and never gets
 * a trail row: it is in-process. Prices on the card come from the two catalogs.
 * The fee is 20% of the absolute gap. Nothing here writes a cart.
 */
import type { CotoSearcher } from '@changuito/mcp/compare';
import type { Product } from '@changuito/mcp/types';

import { feeCentavosOf } from '../checkout/compare-fee.ts';
import type { SearchCompareItem, UiEvent } from '../protocol.ts';
import type { RenderCache } from './render-tools.ts';

const COTO_MS = 10_000;

const ars = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

export function dualSearchOn(input: {
  compareOn: boolean;
  cotoEnabled: boolean;
  retailer?: string;
}): boolean {
  return input.compareOn === true && input.cotoEnabled === true && input.retailer === 'dia';
}

export function searchCompareNote(args: {
  id: string;
  dia: number;
  coto: number;
  matched: number;
  gapCentavos?: number;
  hits: ReadonlyArray<{ id: string; name: string; shelfCentavos: number; available: boolean }>;
}): string {
  const gap = args.gapCentavos === undefined ? 'gap=unknown' : `gapCentavos=${args.gapCentavos}`;
  const head = `[search_compare: id=${args.id} dia=${args.dia} coto=${args.coto} matched=${args.matched} ${gap}]`;
  const lines = args.hits
    .filter((hit) => hit.available && hit.shelfCentavos > 0)
    .map((hit) => `${hit.id} · ${hit.name} · ${ars.format(hit.shelfCentavos / 100)}`);
  return [head, ...lines].join('\n');
}

function recordSearch(cache: RenderCache, query: string, retailer: 'dia' | 'coto', available: number): void {
  const searches = cache.searches ? [...cache.searches] : [];
  searches.push({ query, retailer, available });
  cache.searches = searches;
}

function diaItems(products: readonly Product[]): SearchCompareItem[] {
  const items: SearchCompareItem[] = [];
  for (const product of products) {
    const shelfCentavos = product.price?.centavos;
    if (!product.available || !product.skuId || !product.name) continue;
    if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos <= 0) continue;
    items.push({ id: product.skuId, name: product.name, shelfCentavos, available: true });
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

      const diaView = dia.failed ? [] : diaItems(dia.products);
      const cotoView: SearchCompareItem[] = folded.coto
        .filter((hit) => hit.available && hit.shelfCentavos > 0)
        .map((hit) => ({
          id: hit.id,
          name: hit.name,
          shelfCentavos: hit.shelfCentavos,
          available: true,
        }));
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
      recordSearch(args.cache, args.query, 'dia', diaView.length);
      recordSearch(args.cache, args.query, 'coto', cotoView.length);

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
        hits: cotoView,
      });
    },
  };
}
