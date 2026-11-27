/**
 * Search-time Día and Coto.
 *
 * The Coto lookup starts in the same turn as the Día MCP call and never gets
 * a trail row: it is in-process. Prices on the card come from the two catalogs.
 * Once a chain is chosen, only that chain is queried. The fee stays on the
 * model note for a dual search; the shopper sees it on the close table.
 * Nothing here writes a cart.
 */
import type { CatalogItem, CotoLookup, CotoSearcher, SearchMatch, TypedPick } from '@changuito/mcp/compare';
import { ofQueryType, typeScore, widerQueries } from '@changuito/mcp/compare';
import type { Product } from '@changuito/mcp/types';

import { feeCentavosOf } from '../checkout/compare-fee.ts';
import { mergeDiaPair } from '../checkout/coto-real.ts';
import { cotoImageUrl } from '../one-per-type.ts';
import type { SearchCompareItem, UiEvent } from '../protocol.ts';
import type { RenderCache } from './render-tools.ts';

const COTO_MS = 10_000;
const CHAIN_VIEW = 6;
const WIDER_MAX = 3;
const COTO_CHAIN_HITS = 24;

/** True only while both chains are still open. A chosen order clears the stamp. */
export function dualCheckoutStamp(input: {
  demoOn: boolean;
  cotoEnabled: boolean;
  order?: string;
}): boolean {
  return input.demoOn === true && input.cotoEnabled === true && input.order === undefined;
}

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
  /** `same` is one product. `similar` is the same food type. `none` has no gap. */
  match?: SearchMatch;
  /** Ids on the card that came from an earlier search, not this lookup. */
  seen?: readonly string[];
  /** A cart line that is this type. The model names it instead of calling it missing. */
  inCart?: string;
  hits: ReadonlyArray<{ id: string; name: string; shelfCentavos: number; available: boolean }>;
}): string {
  const gap = args.gapCentavos === undefined ? 'gap=unknown' : `gapCentavos=${args.gapCentavos}`;
  const pair = args.pair ? ` pairDia=${args.pair.diaSkuId} pairCoto=${args.pair.cotoId}` : '';
  const pickDia = args.pickDia ? ` pickDia=${args.pickDia}` : '';
  const pickCoto = args.pickCoto ? ` pickCoto=${args.pickCoto}` : '';
  const match = args.match ?? 'none';
  const seen = args.seen && args.seen.length > 0 ? ` seen=${args.seen.join(',')}` : '';
  const inCart = args.inCart ? ` inCart=${args.inCart}` : '';
  const head = `[search_compare: id=${args.id} dia=${args.dia} coto=${args.coto} matched=${args.matched} ${gap}${pair}${pickDia}${pickCoto} match=${match}${seen}${inCart}]`;
  const lines = args.hits
    .filter((hit) => hit.available && hit.shelfCentavos > 0)
    .map((hit) => `${hit.id} · ${hit.name} · ${ars.format(hit.shelfCentavos / 100)}`);
  return [head, ...lines].join('\n');
}

/**
 * Chosen-chain card. Best type score first. Within one score, ids this
 * thread has not shown come before ones already on a card, then the lower
 * price. "más opciones" (every hit ties) still leads with a new SKU. A
 * precise ask still leads with the best match, even when that SKU was
 * already drawn.
 */
function rankedView(
  items: readonly SearchCompareItem[],
  query: string,
  limit: number,
  shown: readonly string[],
): SearchCompareItem[] {
  const shownSet = new Set(shown);
  const typed = items.filter(
    (item) => item.available && item.shelfCentavos > 0 && ofQueryType(query, item),
  );
  typed.sort((a, b) => {
    const score = typeScore(query, b) - typeScore(query, a);
    if (score !== 0) return score;
    const seen = Number(shownSet.has(a.id)) - Number(shownSet.has(b.id));
    if (seen !== 0) return seen;
    return a.shelfCentavos - b.shelfCentavos;
  });
  return typed.slice(0, limit);
}

function recordSearch(cache: RenderCache, query: string, retailer: 'dia' | 'coto', available: number): void {
  const searches = cache.searches ? [...cache.searches] : [];
  searches.push({ query, retailer, available });
  cache.searches = searches;
}

/** Every Día sku this search returned. `render_products` will not draw them again. */
function rememberCompared(cache: RenderCache, products: readonly Product[]): void {
  const ids = products.flatMap((product) => (product.skuId ? [product.skuId] : []));
  if (!ids.length) return;
  const seen = new Set(cache.compared ?? []);
  for (const id of ids) seen.add(id);
  cache.compared = [...seen];
}

function typedCount(
  query: string,
  items: ReadonlyArray<{ name: string; brand?: string; available: boolean; shelfCentavos: number }>,
): number {
  let count = 0;
  for (const item of items) {
    if (!item.available || !Number.isSafeInteger(item.shelfCentavos) || item.shelfCentavos <= 0) continue;
    if (ofQueryType(query, item)) count += 1;
  }
  return count;
}

function pickItem(pick: TypedPick, chain: 'dia' | 'coto', match: SearchMatch): SearchCompareItem {
  const imageUrl = chain === 'coto' ? cotoImageUrl(pick.id, pick.imageUrl) : pick.imageUrl;
  const item: SearchCompareItem = {
    id: pick.id,
    name: pick.name,
    shelfCentavos: pick.shelfCentavos,
    available: pick.available,
  };
  if (pick.brand) item.brand = pick.brand;
  if (imageUrl) item.imageUrl = imageUrl;
  if (typeof pick.unitMultiplier === 'number' && pick.unitMultiplier > 0 && pick.measurementUnit) {
    item.unitMultiplier = pick.unitMultiplier;
    item.measurementUnit = pick.measurementUnit;
  }
  if (match === 'same' || match === 'similar') item.match = match;
  return item;
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

function rememberShown(cache: RenderCache, ids: readonly string[]): void {
  if (!ids.length) return;
  const seen = new Set(cache.shown ?? []);
  for (const id of ids) seen.add(id);
  cache.shown = [...seen];
}

function seenIds(view: readonly { id: string }[], live: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const item of view) {
    if (!live.has(item.id)) out.push(item.id);
  }
  return out;
}

function inCartId(cache: RenderCache, query: string, cotoLineIds?: readonly string[]): string | undefined {
  for (const line of cache.cart?.lines ?? []) {
    if (ofQueryType(query, { name: line.name })) return line.skuId;
  }
  for (const id of cotoLineIds ?? []) {
    const hit = cache.coto?.[id];
    if (hit && ofQueryType(query, hit)) return id;
  }
  return undefined;
}

function cartChainOf(cache: RenderCache, id: string | undefined, cotoLineIds?: readonly string[]): 'dia' | 'coto' | undefined {
  if (!id) return undefined;
  if (cache.cart?.lines.some((line) => line.skuId === id)) {
    return cache.cart.retailer === 'coto' ? 'coto' : cache.cart.retailer === 'dia' ? 'dia' : undefined;
  }
  if (cotoLineIds?.includes(id)) return 'coto';
  return undefined;
}

/** A price the card can show for a line the basket already holds. */
function cartCard(cache: RenderCache, id: string): SearchCompareItem | undefined {
  const line = cache.cart?.lines.find((row) => row.skuId === id);
  if (line && line.unitPrice.centavos > 0) {
    return {
      id: line.skuId,
      name: line.name,
      shelfCentavos: line.unitPrice.centavos,
      available: line.available,
    };
  }
  const hit = cache.coto?.[id];
  if (hit && hit.shelfCentavos > 0) {
    return cardItem({
      id: hit.id,
      name: hit.name,
      shelfCentavos: hit.shelfCentavos,
      available: hit.available,
      brand: hit.brand,
      imageUrl: cotoImageUrl(hit.id, hit.imageUrl),
    });
  }
  const product = cache.products.get(id);
  const cents = product?.price?.centavos;
  if (product?.skuId && product.name && Number.isSafeInteger(cents) && (cents ?? 0) > 0) {
    return cardItem({
      id: product.skuId,
      name: product.name,
      shelfCentavos: cents as number,
      available: product.available === true,
      brand: product.brand,
      imageUrl: product.imageUrl,
      unitMultiplier: product.unitMultiplier,
      measurementUnit: product.measurementUnit,
    });
  }
  return undefined;
}

function holdChain(
  view: SearchCompareItem[],
  cache: RenderCache,
  chain: 'dia' | 'coto',
  inCart: string | undefined,
  heldBy: 'dia' | 'coto' | undefined,
): SearchCompareItem[] {
  if (view.length > 0 || !inCart || heldBy !== chain) return view;
  const item = cartCard(cache, inCart);
  return item ? [item] : view;
}

function withRememberedDia(products: readonly Product[], cache: RenderCache, query: string): Product[] {
  const byId = new Map<string, Product>();
  for (const product of products) {
    if (product.skuId) byId.set(product.skuId, product);
  }
  for (const product of cache.products.values()) {
    if (!product.skuId || byId.has(product.skuId)) continue;
    const cents = product.price?.centavos;
    if (product.available !== true || !Number.isSafeInteger(cents) || (cents ?? 0) <= 0) continue;
    if (!ofQueryType(query, product)) continue;
    byId.set(product.skuId, product);
  }
  return [...byId.values()];
}

function withRememberedCoto(items: readonly CatalogItem[], cache: RenderCache, query: string): CatalogItem[] {
  const byId = new Map<string, CatalogItem>();
  for (const item of items) {
    if (item.id) byId.set(item.id, item);
  }
  for (const hit of Object.values(cache.coto ?? {})) {
    if (byId.has(hit.id)) continue;
    if (!hit.available || hit.shelfCentavos <= 0) continue;
    if (!ofQueryType(query, hit)) continue;
    byId.set(hit.id, {
      id: hit.id,
      name: hit.name,
      shelfPrice: { centavos: hit.shelfCentavos, display: '' },
      priceSource: 'store_200',
      available: true,
      ...(hit.ean ? { ean: hit.ean } : {}),
      ...(hit.brand ? { brand: hit.brand } : {}),
      ...(hit.url ? { url: hit.url } : {}),
      ...(hit.imageUrl ? { imageUrl: hit.imageUrl } : {}),
    });
  }
  return [...byId.values()];
}

function diaHasType(products: readonly Product[], query: string): boolean {
  return products.some((product) => {
    const cents = product.price?.centavos;
    return (
      product.available === true &&
      Boolean(product.skuId) &&
      Boolean(product.name) &&
      Number.isSafeInteger(cents) &&
      (cents ?? 0) > 0 &&
      ofQueryType(query, product)
    );
  });
}

function cotoHasType(items: readonly CatalogItem[], query: string): boolean {
  return items.some((item) => {
    const cents = item.shelfPrice?.centavos;
    return (
      item.available === true &&
      Boolean(item.id) &&
      Boolean(item.name) &&
      Number.isSafeInteger(cents) &&
      (cents ?? 0) > 0 &&
      ofQueryType(query, item)
    );
  });
}

function storeCatalog(cache: RenderCache, items: readonly CatalogItem[]): void {
  const cotoCache = { ...(cache.coto ?? {}) };
  let wrote = false;
  for (const item of items) {
    const shelfCentavos = item.shelfPrice?.centavos;
    if (!item.id || !item.name || !Number.isSafeInteger(shelfCentavos) || shelfCentavos <= 0) continue;
    wrote = true;
    cotoCache[item.id] = {
      id: item.id,
      name: item.name,
      shelfCentavos,
      available: item.available === true,
      ...(item.ean ? { ean: item.ean } : {}),
      ...(item.brand ? { brand: item.brand } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    };
  }
  if (wrote) cache.coto = cotoCache;
}

function idsOf(items: readonly { id?: string; skuId?: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.id) ids.add(item.id);
    if (item.skuId) ids.add(item.skuId);
  }
  return ids;
}

type DiaPass = { products: readonly Product[]; failed: boolean; term: string; live: Set<string> };
type CotoPass = { lookup: CotoLookup; term: string; live: Set<string> };

type DiaSearch = (term: string) => Promise<{ products: readonly Product[]; failed: boolean }>;

async function resolveDia(
  query: string,
  products: readonly Product[],
  failed: boolean,
  cache: RenderCache,
  searchDia?: DiaSearch,
): Promise<DiaPass> {
  const live = idsOf(products.map((product) => ({ skuId: product.skuId })));
  if (failed) return { products, failed: true, term: query, live };
  let nextProducts = withRememberedDia(products, cache, query);
  let term = query;
  if (!diaHasType(nextProducts, term) && searchDia) {
    for (const wider of widerQueries(query).slice(0, WIDER_MAX)) {
      const again = await searchDia(wider);
      if (again.failed) continue;
      for (const id of idsOf(again.products.map((product) => ({ skuId: product.skuId })))) live.add(id);
      const merged = withRememberedDia(again.products, cache, wider);
      if (diaHasType(merged, wider)) {
        nextProducts = merged;
        term = wider;
        break;
      }
    }
  }
  return { products: nextProducts, failed: false, term, live };
}

async function resolveCoto(
  query: string,
  first: CotoLookup,
  cache: RenderCache,
  searcher: CotoSearcher,
  leftMs: () => number,
  limit: number,
): Promise<CotoPass> {
  const live = new Set<string>();
  if (!first.ok) return { lookup: first, term: query, live };
  for (const item of first.items) if (item.id) live.add(item.id);
  storeCatalog(cache, first.items);
  let items = withRememberedCoto(first.items, cache, query);
  let term = query;
  if (!cotoHasType(items, term)) {
    for (const wider of widerQueries(query).slice(0, WIDER_MAX)) {
      const ms = leftMs();
      if (ms <= 0) break;
      const again = await cappedLookup(wider, searcher, ms, limit);
      if (!again.ok) continue;
      storeCatalog(cache, again.items);
      for (const item of again.items) if (item.id) live.add(item.id);
      const merged = withRememberedCoto(again.items, cache, wider);
      if (cotoHasType(merged, wider)) {
        items = merged;
        term = wider;
        break;
      }
    }
  }
  return { lookup: { ok: true, items }, term, live };
}

function catalogCards(items: readonly CatalogItem[]): SearchCompareItem[] {
  const cards: SearchCompareItem[] = [];
  for (const item of items) {
    const shelfCentavos = item.shelfPrice?.centavos;
    if (!item.available || !item.id || !item.name) continue;
    if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos <= 0) continue;
    cards.push(
      cardItem({
        id: item.id,
        name: item.name,
        shelfCentavos,
        available: true,
        brand: item.brand,
        imageUrl: cotoImageUrl(item.id, item.imageUrl),
      }),
    );
  }
  return cards;
}

function foundCount(typed: number, view: readonly unknown[]): number {
  if (typed > 0) return typed;
  return view.length > 0 ? view.length : 0;
}

async function liveSearcher(): Promise<CotoSearcher> {
  const { cotoSearcher } = await import('@changuito/mcp/compare');
  return cotoSearcher();
}

async function cappedLookup(query: string, searcher: CotoSearcher, ms: number, limit = 12) {
  if (ms <= 0) return { ok: false as const, reason: 'timed_out' as const };
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
    return await Promise.race([lookupCoto(query, searcher, ac.signal, limit), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A build-cart turn still searches. It does not draw a product grid. */
function emitCompare(
  args: { quiet?: boolean; emit: (event: UiEvent) => void },
  event: UiEvent,
): void {
  if (args.quiet) return;
  args.emit(event);
}

/**
 * Emit `pending` and start the Coto lookup now. `finish` runs after the Día
 * tool result is in hand. The lookup is already in flight by then.
 * `quiet` skips both `search_compare` emits. The cache writes and the note stay.
 */
export function beginDualSearch(args: {
  id: string;
  query: string;
  postalCode?: string;
  cache: RenderCache;
  emit: (event: UiEvent) => void;
  /** Skip the search card. The note and the cache writes still happen. */
  quiet?: boolean;
  timeoutMs?: number;
  searcher?: CotoSearcher;
  /** Wider Día pass. In-process, under the search row that is already open. */
  searchDia?: DiaSearch;
  /** Coto line ids on the session, when the cart cache does not name them. */
  cotoLineIds?: readonly string[];
}): { finish(dia: { products: readonly Product[]; failed: boolean }): Promise<string> } {
  emitCompare(args, {
    t: 'search_compare',
    id: args.id,
    status: 'pending',
    query: args.query,
    ...(args.postalCode ? { postalCode: args.postalCode } : {}),
  });
  const budget = args.timeoutMs ?? COTO_MS;
  const started = Date.now();
  const searcher = args.searcher ? Promise.resolve(args.searcher) : liveSearcher();
  const lookup = searcher.then((ready) => cappedLookup(args.query, ready, budget));

  return {
    async finish(dia) {
      const { assembleSearchCompare } = await import('@changuito/mcp/compare');
      const leftMs = () => Math.max(0, budget - (Date.now() - started));
      let first: CotoLookup;
      let ready: CotoSearcher;
      try {
        first = await lookup;
        ready = await searcher;
      } catch {
        first = { ok: false, reason: 'error' };
        ready = { async search() { return []; } };
      }
      const diaPass = await resolveDia(args.query, dia.products, dia.failed, args.cache, args.searchDia);
      const cotoPass = await resolveCoto(args.query, first, args.cache, ready, leftMs, 12);
      let folded;
      try {
        folded = assembleSearchCompare({
          query: args.query,
          diaQuery: diaPass.term,
          cotoQuery: cotoPass.term,
          diaProducts: diaPass.products,
          diaFailed: diaPass.failed,
          coto: cotoPass.lookup,
        });
      } catch {
        folded = assembleSearchCompare({
          query: args.query,
          diaProducts: dia.products,
          diaFailed: dia.failed,
          coto: { ok: false, reason: 'error' },
        });
      }

      const held = inCartId(args.cache, args.query, args.cotoLineIds);
      const heldBy = cartChainOf(args.cache, held, args.cotoLineIds);
      let diaView = folded.diaPick ? [pickItem(folded.diaPick, 'dia', folded.match)] : [];
      let cotoView = folded.cotoPick ? [pickItem(folded.cotoPick, 'coto', folded.match)] : [];
      diaView = holdChain(diaView, args.cache, 'dia', held, heldBy);
      cotoView = holdChain(cotoView, args.cache, 'coto', held, heldBy);
      const cotoDown = folded.status === 'coto_error' || folded.status === 'coto_timed_out';
      const noPair: ('dia' | 'coto')[] = [];
      if (!diaPass.failed && diaView.length === 0 && heldBy !== 'dia') noPair.push('dia');
      if (!diaPass.failed && !cotoDown && cotoView.length === 0 && heldBy !== 'coto') noPair.push('coto');
      const feeCentavos =
        folded.gapCentavos === undefined ? undefined : feeCentavosOf(folded.gapCentavos);

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
      const diaTyped = diaPass.failed ? 0 : typedCount(diaPass.term, diaItems(diaPass.products));
      const cotoTyped = cotoPass.lookup.ok ? typedCount(cotoPass.term, catalogCards(cotoPass.lookup.items)) : 0;
      recordSearch(args.cache, args.query, 'dia', foundCount(diaTyped, diaView));
      recordSearch(args.cache, args.query, 'coto', foundCount(cotoTyped, cotoView));
      rememberCompared(args.cache, dia.products);
      if (diaPass.products !== dia.products) rememberCompared(args.cache, diaPass.products);
      rememberShown(args.cache, [...diaView, ...cotoView].map((item) => item.id));
      const seen = [...seenIds(diaView, diaPass.live), ...seenIds(cotoView, cotoPass.live)];

      emitCompare(args, {
        t: 'search_compare',
        id: args.id,
        status: folded.status,
        query: args.query,
        kind: args.query.trim(),
        ...(noPair.length ? { noPair } : {}),
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
        match: folded.match,
        ...(folded.pair ? { pair: folded.pair } : {}),
        ...(diaView[0] ? { pickDia: diaView[0].id } : {}),
        ...(cotoView[0] ? { pickCoto: cotoView[0].id } : {}),
        ...(seen.length ? { seen } : {}),
        ...(held ? { inCart: held } : {}),
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
  /** Skip the search card. The note and the cache writes still happen. */
  quiet?: boolean;
  timeoutMs?: number;
  searcher?: CotoSearcher;
  /** Wider Día pass. In-process, under the search row that is already open. */
  searchDia?: DiaSearch;
  /** Coto line ids on the session, when the cart cache does not name them. */
  cotoLineIds?: readonly string[];
}): ChainSearch {
  const chains = [args.chain] as ('dia' | 'coto')[];
  emitCompare(args, {
    t: 'search_compare',
    id: args.id,
    status: 'pending',
    query: args.query,
    ...(args.postalCode ? { postalCode: args.postalCode } : {}),
    chains,
  });

  if (args.chain === 'coto') {
    const budget = args.timeoutMs ?? COTO_MS;
    const started = Date.now();
    const searcher = args.searcher ? Promise.resolve(args.searcher) : liveSearcher();
    const lookup = searcher.then((ready) => cappedLookup(args.query, ready, budget, COTO_CHAIN_HITS));
    return {
      async finish() {
        const leftMs = () => Math.max(0, budget - (Date.now() - started));
        let first: CotoLookup;
        let ready: CotoSearcher;
        try {
          first = await lookup;
          ready = await searcher;
        } catch {
          first = { ok: false, reason: 'error' };
          ready = { async search() { return []; } };
        }
        const pass = await resolveCoto(args.query, first, args.cache, ready, leftMs, COTO_CHAIN_HITS);
        const down = !pass.lookup.ok;
        const status = !pass.lookup.ok
          ? pass.lookup.reason === 'timed_out'
            ? 'coto_timed_out'
            : 'coto_error'
          : pass.lookup.items.length === 0
            ? 'coto_empty'
            : 'ok';
        const cards = pass.lookup.ok ? catalogCards(pass.lookup.items) : [];
        const held = inCartId(args.cache, args.query, args.cotoLineIds);
        const heldBy = cartChainOf(args.cache, held, args.cotoLineIds);
        let cotoView = down ? [] : rankedView(cards, pass.term, CHAIN_VIEW, args.cache.shown ?? []);
        cotoView = holdChain(cotoView, args.cache, 'coto', held, heldBy);
        const typed = down ? 0 : typedCount(pass.term, cards);
        recordSearch(args.cache, args.query, 'coto', foundCount(typed, cotoView));
        rememberShown(args.cache, cotoView.map((item) => item.id));
        const seen = seenIds(cotoView, pass.live);
        const noPair = cotoView.length === 0 && !down && heldBy !== 'coto';
        emitCompare(args, {
          t: 'search_compare',
          id: args.id,
          status,
          query: args.query,
          kind: args.query.trim(),
          ...(noPair ? { noPair: ['coto'] as ('dia' | 'coto')[] } : {}),
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
          match: 'none',
          ...(cotoView[0] ? { pickCoto: cotoView[0].id } : {}),
          ...(seen.length ? { seen } : {}),
          ...(held ? { inCart: held } : {}),
          hits: cotoView,
        });
      },
    };
  }

  return {
    async finish(dia) {
      const failed = dia?.failed === true;
      const pass = await resolveDia(args.query, dia?.products ?? [], failed, args.cache, args.searchDia);
      const cards = pass.failed ? [] : diaItems(pass.products);
      const held = inCartId(args.cache, args.query, args.cotoLineIds);
      const heldBy = cartChainOf(args.cache, held, args.cotoLineIds);
      let diaView = pass.failed ? [] : rankedView(cards, pass.term, CHAIN_VIEW, args.cache.shown ?? []);
      diaView = holdChain(diaView, args.cache, 'dia', held, heldBy);
      const typed = pass.failed ? 0 : typedCount(pass.term, cards);
      recordSearch(args.cache, args.query, 'dia', foundCount(typed, diaView));
      if (dia) rememberCompared(args.cache, dia.products);
      if (pass.products !== dia?.products) rememberCompared(args.cache, pass.products);
      rememberShown(args.cache, diaView.map((item) => item.id));
      const seen = seenIds(diaView, pass.live);
      const noPair = diaView.length === 0 && !pass.failed && heldBy !== 'dia';
      emitCompare(args, {
        t: 'search_compare',
        id: args.id,
        status: pass.failed ? 'dia_error' : 'ok',
        query: args.query,
        kind: args.query.trim(),
        ...(noPair ? { noPair: ['dia'] as ('dia' | 'coto')[] } : {}),
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
        match: 'none',
        ...(diaView[0] ? { pickDia: diaView[0].id } : {}),
        ...(seen.length ? { seen } : {}),
        ...(held ? { inCart: held } : {}),
        hits: diaView,
      });
    },
  };
}
