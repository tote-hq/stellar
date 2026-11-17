/**
 * Quote one Día basket against the Coto catalog.
 * Identifiers in, prices from the two sources. No cart, no checkout on Coto.
 * A lookup that fails rejects the whole basket: a partial quote would understate the fee.
 */
import { getAdapter } from '../adapters/registry.js';
import type { Product } from '../types.js';
import { CotoCatalog } from './coto.js';
import { matchDiaToCoto, type CotoSearcher, type MatchConfidence } from './match.js';

export interface CompareLine {
  skuId: string;
  name: string;
  quantity: number;
  lineTotal: { centavos: number };
}

/** Reads EAN and brand. The cart line does not carry either. */
export interface DiaCatalog {
  getProduct(skuId: string): Promise<Pick<Product, 'brand' | 'ean'> | null>;
}

export interface CompareCoto {
  id: string;
  name: string;
  shelfCentavos: number;
  lineCentavos: number;
  available: boolean;
}

export interface CompareRow {
  skuId: string;
  name: string;
  quantity: number;
  diaLineCentavos: number;
  confidence: MatchConfidence;
  coto?: CompareCoto;
}

function assertLine(line: CompareLine): void {
  if (!line.skuId || !line.name) throw new Error('dia line missing identity');
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('dia line quantity');
  if (!Number.isSafeInteger(line.lineTotal?.centavos) || line.lineTotal.centavos < 0) {
    throw new Error('dia line total');
  }
}

async function compareLine(line: CompareLine, dia: DiaCatalog, coto: CotoSearcher): Promise<CompareRow> {
  assertLine(line);
  const product = await dia.getProduct(line.skuId);
  if (!product) throw new Error('dia product missing');

  const asProduct: Product = {
    skuId: line.skuId,
    productId: line.skuId,
    name: line.name,
    brand: product.brand,
    ean: product.ean,
    sellerId: '1',
    price: { centavos: line.lineTotal.centavos, display: '' },
    available: true,
  };
  const found = await matchDiaToCoto(asProduct, coto);
  const row: CompareRow = {
    skuId: line.skuId,
    name: line.name,
    quantity: line.quantity,
    diaLineCentavos: line.lineTotal.centavos,
    confidence: found.confidence,
  };
  if (!found.match || found.confidence === 'none') return row;

  const shelfCentavos = found.match.shelfPrice.centavos;
  const lineCentavos = shelfCentavos * line.quantity;
  if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos < 0 || !Number.isSafeInteger(lineCentavos)) {
    throw new Error('coto line total');
  }
  row.coto = {
    id: found.match.id,
    name: found.match.name,
    shelfCentavos,
    lineCentavos,
    available: found.match.available,
  };
  return row;
}

/**
 * One row per available Día line. `coto.lineCentavos` is the shelf times quantity.
 * Brand + size is returned on the row and is not a high-confidence match.
 */
export async function compareBasket(
  lines: readonly CompareLine[],
  dia: DiaCatalog,
  coto: CotoSearcher,
): Promise<CompareRow[]> {
  const rows: CompareRow[] = [];
  for (const line of lines) rows.push(await compareLine(line, dia, coto));
  return rows;
}

/** Día adapter lookup for a postal code. One region resolution for the whole basket. */
export function diaLookup(postalCode: string): DiaCatalog {
  const adapter = getAdapter('dia');
  let location: ReturnType<typeof adapter.resolveLocation> | undefined;
  return {
    getProduct(skuId: string) {
      location ??= adapter.resolveLocation(postalCode);
      return location.then((ctx) => adapter.getProduct(skuId, ctx));
    },
  };
}

/** The catalog searcher. Not a retailer: it cannot cart or check out. */
export function cotoSearcher(): CotoSearcher {
  return new CotoCatalog();
}
