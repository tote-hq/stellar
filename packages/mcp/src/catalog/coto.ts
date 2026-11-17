/**
 * Catalog-only Coto source. Search, product, and the anonymous shelf price.
 * Not a RetailerAdapter: no cart, no login, no delivery, no checkout.
 * The public Constructor key is read from the storefront bundle at runtime
 * and kept in memory. It is never written, logged, or put in an error.
 */
import { RetailerError } from '../types.js';
import type { Money } from '../types.js';
import { fromPesos } from '../util/money.js';
import { normalizeEan, sizeFromName, type NameSize } from './normalize.js';

const ANONYMOUS_STORE = '200';
const GAP_MS = 400;
const TIMEOUT_MS = 25_000;
const STOREFRONT = 'https://www.coto.com.ar';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export type PriceSource = 'store_200' | 'product_list_price';

/** What `formatPrice` is quoted per. Not the pack's net content. */
export interface UnitBasis {
  quantity?: number;
  format?: string;
  role: 'unit_price_basis';
}

export interface CatalogItem {
  id: string;
  name: string;
  url?: string;
  imageUrl?: string;
  shelfPrice: Money;
  priceSource: PriceSource;
  /** Set only when `product_list_price` differs from the shelf. */
  listPrice?: Money;
  ean?: string;
  brand?: string;
  available: boolean;
  /** Pack net content from the name. Absent when the name has none. */
  size?: NameSize;
  unitBasis?: UnitBasis;
}

export interface CotoPriceRow {
  store?: string | number;
  listPrice?: number;
  /** Unit reference. Never the shelf. */
  formatPrice?: number;
  priceWithoutTax?: number | null;
}

export interface CotoSearchHit {
  value?: string;
  data?: {
    id?: string | number;
    url?: string;
    image_url?: string;
    product_large_image_url?: string;
    product_medium_image_url?: string;
    price?: CotoPriceRow[];
    sku_display_name?: string;
    sku_description?: string;
    product_list_price?: number | string;
    product_main_ean?: string | number;
    product_brand?: string;
    /** Unit `formatPrice` is quoted per. Not the pack's net content. */
    product_format?: string;
    product_format_quantity?: number;
    store_availability?: unknown;
    /**
     * Promo copy and a promo price. Ignored: the shelf is `listPrice`.
     * `discountPrice` is a display string, not the anonymous shelf.
     */
    discounts?: Array<{
      discountText?: string;
      discountPrice?: string;
      regularPrice?: number | null;
    }>;
    /** Loyalty price, when the index sends one. Never the shelf. */
    comunidadPrice?: number | string;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tail: Promise<void> = Promise.resolve();

/** One Constructor or storefront call at a time, with a gap after each. */
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => sleep(GAP_MS),
    () => sleep(GAP_MS),
  ).then(() => undefined);
  return run;
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/** Network failures stay generic so a URL that carries the key cannot leak. */
function networkFailure(e: unknown): RetailerError {
  if (e instanceof RetailerError) return e;
  if (isTimeout(e)) return new RetailerError('timeout', 'UPSTREAM');
  return new RetailerError('request failed', 'UPSTREAM');
}

async function pacedGet(url: string, accept: string): Promise<{ status: number; text: string }> {
  return paced(async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: accept, 'Accept-Language': 'es-AR,es;q=0.9', 'User-Agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      throw networkFailure(e);
    }
  });
}

let cachedKey: string | undefined;
let pendingKey: Promise<string> | undefined;

async function fetchPublicKey(): Promise<string> {
  const home = await pacedGet(`${STOREFRONT}/`, 'text/html');
  if (home.status === 429) throw new RetailerError('Rate limited by the store', 'RATE_LIMITED');
  if (home.status !== 200) throw new RetailerError(`storefront HTTP ${home.status}`, 'UPSTREAM');
  const main = home.text.match(/src="(\/main\.[a-f0-9]+\.js)"/);
  if (!main?.[1]) throw new RetailerError('storefront HTML had no main bundle', 'UPSTREAM');
  const bundle = await pacedGet(`${STOREFRONT}${main[1]}`, '*/*');
  if (bundle.status === 429) throw new RetailerError('Rate limited by the store', 'RATE_LIMITED');
  if (bundle.status !== 200) throw new RetailerError(`storefront bundle HTTP ${bundle.status}`, 'UPSTREAM');
  const found = bundle.text.match(/constructor:\{apiKey:"(key_[A-Za-z0-9]+)"/);
  if (!found?.[1]) throw new RetailerError('storefront bundle had no public Constructor key', 'UPSTREAM');
  return found[1];
}

/**
 * The public index key from the storefront bundle (`constructor.apiKey`).
 * Cached for the process. No cookies, no session, and the value is not
 * returned in errors.
 */
export function discoverPublicKey(): Promise<string> {
  if (cachedKey) return Promise.resolve(cachedKey);
  if (!pendingKey) {
    pendingKey = fetchPublicKey()
      .then((key) => {
        cachedKey = key;
        return key;
      })
      .finally(() => {
        pendingKey = undefined;
      });
  }
  return pendingKey;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

function positivePesos(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null || !(n > 0)) return null;
  if (fromPesos(n).centavos <= 0) return null;
  return n;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function absoluteUrl(path: string | undefined): string | undefined {
  const value = path?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${STOREFRONT}/${value.replace(/^\/+/, '')}`;
}

function imageOf(data: NonNullable<CotoSearchHit['data']>): string | undefined {
  for (const candidate of [data.image_url, data.product_large_image_url, data.product_medium_image_url]) {
    const url = candidate?.trim();
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}

function unitBasisOf(data: NonNullable<CotoSearchHit['data']>): UnitBasis | undefined {
  const format = data.product_format?.trim() || undefined;
  const quantity =
    typeof data.product_format_quantity === 'number' && Number.isFinite(data.product_format_quantity)
      ? data.product_format_quantity
      : undefined;
  if (!format && quantity == null) return undefined;
  const basis: UnitBasis = { role: 'unit_price_basis' };
  if (quantity != null) basis.quantity = quantity;
  if (format) basis.format = format;
  return basis;
}

/**
 * One Constructor hit → a catalog row, or null when it has no positive shelf.
 * The shelf is `data.price[store=200].listPrice`. `formatPrice`, discounts,
 * and any Comunidad price are not read. Pack size comes from the name.
 */
export function toCatalogItem(hit: CotoSearchHit | null | undefined): CatalogItem | null {
  const data = hit?.data;
  if (!data) return null;
  const id = asText(data.id);
  const name = (hit?.value || data.sku_display_name || data.sku_description || '').trim();
  if (!id || !name) return null;

  const storeRow = (data.price ?? []).find((row) => String(row.store) === ANONYMOUS_STORE);
  let shelfPesos = positivePesos(storeRow?.listPrice);
  let priceSource: PriceSource = 'store_200';
  if (shelfPesos == null) {
    const fallback = positivePesos(data.product_list_price);
    if (fallback == null) return null;
    shelfPesos = fallback;
    priceSource = 'product_list_price';
  }
  const shelfPrice = fromPesos(shelfPesos);
  const listPesos = positivePesos(data.product_list_price);
  const list = listPesos == null ? undefined : fromPesos(listPesos);
  const listPrice = list && list.centavos !== shelfPrice.centavos ? list : undefined;

  const ean = asText(data.product_main_ean);
  const brand = data.product_brand?.trim() || undefined;
  const availability = data.store_availability;
  const available =
    Array.isArray(availability) && availability.some((storeId) => String(storeId) === ANONYMOUS_STORE);
  const size = sizeFromName(name) ?? undefined;
  const url = absoluteUrl(data.url);
  const imageUrl = imageOf(data);
  const unitBasis = unitBasisOf(data);

  const item: CatalogItem = { id, name, shelfPrice, priceSource, available };
  if (url) item.url = url;
  if (imageUrl) item.imageUrl = imageUrl;
  if (listPrice) item.listPrice = listPrice;
  if (ean) item.ean = ean;
  if (brand) item.brand = brand;
  if (size) item.size = size;
  if (unitBasis) item.unitBasis = unitBasis;
  return item;
}

function clampLimit(limit: number | undefined): number {
  const n = limit == null || !Number.isFinite(limit) ? 10 : Math.floor(limit);
  if (n < 1) return 1;
  if (n > 20) return 20;
  return n;
}

async function searchHits(query: string, limit: number): Promise<CotoSearchHit[]> {
  const key = await discoverPublicKey();
  const params = new URLSearchParams({
    key,
    section: 'Products',
    num_results_per_page: String(limit),
  });
  const url = `https://ac.cnstrc.com/search/${encodeURIComponent(query)}?${params}`;
  const res = await pacedGet(url, 'application/json');
  if (res.status === 429) throw new RetailerError('Rate limited by the store', 'RATE_LIMITED');
  if (res.status !== 200) throw new RetailerError(`HTTP ${res.status}`, 'UPSTREAM');
  const head = res.text.trimStart()[0];
  if (head !== '{' && head !== '[') {
    throw new RetailerError('non-JSON response (possible bot challenge)', 'UPSTREAM');
  }
  try {
    const body = JSON.parse(res.text) as { response?: { results?: CotoSearchHit[] } };
    return body.response?.results ?? [];
  } catch {
    throw new RetailerError('non-JSON response (possible bot challenge)', 'UPSTREAM');
  }
}

/**
 * Exact `id`, or an all-digit id that equals the EAN after stripping leading
 * zeros. A nearby search hit is not a product.
 */
export function selectExact(id: string, items: readonly CatalogItem[]): CatalogItem | null {
  const want = id.trim();
  if (!want) return null;
  const byId = items.find((item) => item.id === want);
  if (byId) return byId;
  if (!/^\d+$/.test(want)) return null;
  const ean = normalizeEan(want);
  if (!ean) return null;
  return items.find((item) => normalizeEan(item.ean) === ean) ?? null;
}

export class CotoCatalog {
  async search(query: string, opts?: { limit?: number }): Promise<CatalogItem[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = clampLimit(opts?.limit);
    const hits = await searchHits(q, limit);
    const items: CatalogItem[] = [];
    for (const hit of hits) {
      const item = toCatalogItem(hit);
      if (item) items.push(item);
      if (items.length >= limit) break;
    }
    return items;
  }

  /** Constructor search filtered to this id or EAN. Null when nothing matches exactly. */
  async getProduct(id: string): Promise<CatalogItem | null> {
    const want = id.trim();
    if (!want) return null;
    const items = await this.search(want, { limit: 10 });
    return selectExact(want, items);
  }
}
