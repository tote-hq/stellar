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
