/**
 * A Changuito-held Coto basket.
 *
 * Oracle ATG, the store link and payment are not here. Each read prices every
 * line from `CotoCatalog.getProduct` (exact id or EAN). The model never sends
 * a price or a name. An id that does not resolve exactly is an error, so a
 * Día SKU cannot sit in this basket.
 */
import type { Cart, CartLine } from '../types.js';
import { fromCentavos } from '../util/money.js';
import type { CatalogItem } from './coto.js';

export interface CotoQty {
  id: string;
  quantity: number;
}

export interface CotoPricer {
  getProduct(id: string): Promise<CatalogItem | null>;
}

function assertQty(line: CotoQty): CotoQty {
  const id = line.id.trim();
  if (!id || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new Error('coto line');
  }
  return { id, quantity: line.quantity };
}

/** Add quantities onto a copy. The same id increases the line; it does not duplicate it. */
export function addCotoLines(lines: readonly CotoQty[], items: readonly CotoQty[]): CotoQty[] {
  const next = lines.map((line) => ({ ...line }));
  for (const raw of items) {
    const item = assertQty(raw);
    const found = next.find((line) => line.id === item.id);
    if (found) found.quantity += item.quantity;
    else next.push(item);
  }
  return next;
}

/** Quantity 0 removes the line. The index is the one `view_cart` showed. */
export function setCotoQuantity(lines: readonly CotoQty[], index: number, quantity: number): CotoQty[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= lines.length) {
    throw new Error('coto line index');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('coto quantity');
  const next = lines.map((line) => ({ ...line }));
  if (quantity === 0) {
    next.splice(index, 1);
    return next;
  }
  const current = next[index];
  if (!current) throw new Error('coto line index');
  next[index] = { id: current.id, quantity };
  return next;
}

/**
 * Price the lines now. `getProduct` is the exact-match lookup; null is not a
 * nearby hit and must not become a row.
 */
export async function priceCotoCart(
  cartId: string,
  lines: readonly CotoQty[],
  catalog: CotoPricer,
): Promise<Cart> {
  const priced: CartLine[] = [];
  let total = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const item = await catalog.getProduct(line.id);
    if (!item) throw new Error(`Coto id ${line.id} is not an exact catalog match.`);
    const unit = item.shelfPrice.centavos;
    if (!Number.isSafeInteger(unit) || unit <= 0) {
      throw new Error(`Coto id ${line.id} has no shelf price.`);
    }
    const lineTotal = unit * line.quantity;
    total += lineTotal;
    priced.push({
      index,
      skuId: item.id,
      name: item.name,
      quantity: line.quantity,
      sellerId: 'coto',
      unitPrice: fromCentavos(unit),
      lineTotal: fromCentavos(lineTotal),
      available: item.available,
    });
  }
  return {
    retailer: 'coto',
    cartId,
    lines: priced,
    total: fromCentavos(total),
    messages: [],
  };
}
