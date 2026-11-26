/**
 * One product per type, and which image URL a card may load.
 *
 * No imports: the web tests load this file by stripping types, and a
 * relative import would fail at load. The pick reads catalog fields only.
 * A model argument never reaches it.
 */

export interface PricedItem {
  available: boolean;
  shelfCentavos: number;
}

/**
 * The cheapest item that can be shown.
 * Unavailable rows and a price that is not a safe positive integer are
 * skipped. A tie keeps the first item in catalog order.
 */
export function cheapestAvailable<T extends PricedItem>(items: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (item.available !== true) continue;
    const price = item.shelfCentavos;
    if (!Number.isSafeInteger(price) || price <= 0) continue;
    if (!best || price < best.shelfCentavos) best = item;
  }
  return best;
}

/**
 * An image the card may request.
 * Only an absolute http(s) URL. A relative or protocol-relative path is
 * dropped. Nothing here prefixes a host.
 */
export function cardImageUrl(url?: string): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

/**
 * A Coto photo the card may request.
 * An absolute catalog URL wins. Otherwise, only an 8-digit id uses the
 * `large/{first six}00/{id}.jpg` path. That path is proven for `00015889`
 * only. A wrong guess fails the image load and the card shows the empty
 * square. A `coto-<uuid>` basket id never matches.
 */
export function cotoImageUrl(id: string | undefined, imageUrl?: string): string | undefined {
  const catalog = cardImageUrl(imageUrl);
  if (catalog) return catalog;
  if (typeof id !== 'string' || !/^\d{8}$/.test(id)) return undefined;
  return `https://static.cotodigital3.com.ar/sitios/fotos/large/${id.slice(0, 6)}00/${id}.jpg`;
}
