/**
 * Real Coto checkout, the part that can be decided without a browser.
 *
 * The demo path stays in coto-guard.ts. This file never calls it.
 * Prices come from a catalog lookup and from the chain-pick snapshot.
 * A number the browser sent is not an input to the lock.
 */
import {
  comparisonTotals,
  countsTowardFee,
  type ComparisonRow,
  type FeeBasis,
} from './compare-fee.ts';

export const COTO_REAL_KIND = 'coto_real_v1';

export const COTO_REAL_PHASES = ['login', 'delivery', 'empty_cart', 'shop', 'checkout', 'payment'] as const;

const REFUND_REASONS = new Set([
  'payment_failed',
  'payment_declined',
  's5',
  's6',
  's7',
  'needs_human_timeout',
  'cancel',
]);

const POSTAL = /^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/;

export interface DiaPair {
  cotoId: string;
  diaSkuId: string;
  diaCentavos: number;
  confidence: 'ean' | 'brand_size_unit';
}

export interface CotoRealDia {
  pairs: DiaPair[];
  buyer?: string;
}

export interface CoverageAddress {
  postalCode: string;
  street: string;
  number?: string;
  city: string;
}

export interface PricedLine {
  skuId: string;
  name: string;
  quantity: number;
  unitCentavos: number;
  available: boolean;
}

export interface CotoRealQuote {
  checkoutKind: typeof COTO_REAL_KIND;
  postalCode: string;
  coverage: 'ops' | 'table';
  cotoTicketCentavos: number;
  diaMatchedCentavos: number;
  gapCentavos: number;
  feeCentavos: number;
  feeBasis: FeeBasis;
  lockCentavos: number;
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(/[\s,]+/)) {
    const address = part.trim();
    if (address) out.add(address);
  }
  return out;
}

/** Enabled flag and a non-empty list. An empty list admits nobody. Mock flags are not read. */
export function admitCotoReal(args: {
  address: string;
  enabled: boolean;
  allowlist: ReadonlySet<string>;
}): boolean {
  return args.enabled === true && args.allowlist.size > 0 && args.allowlist.has(args.address);
}

export function normalizePostal(raw: string): string | undefined {
  const value = raw.trim().toUpperCase();
  return POSTAL.test(value) ? value : undefined;
}

/** Ops address first, then the CP table. The street stays on the server. */
export function resolveCoverage(
  postalCode: string,
  opts: { ops?: CoverageAddress | null; table: readonly CoverageAddress[] },
): { ok: true; coverage: 'ops' | 'table' } | { ok: false } {
  const want = postalCode.toUpperCase();
  const ops = opts.ops;
  if (ops && ops.postalCode.toUpperCase() === want && ops.street.trim() && ops.city.trim()) {
    return { ok: true, coverage: 'ops' };
  }
  const row = opts.table.find(
    (item) => item.postalCode.toUpperCase() === want && item.street.trim() && item.city.trim(),
  );
  if (row) return { ok: true, coverage: 'table' };
  return { ok: false };
}

export function parseCpTable(raw: string | undefined): CoverageAddress[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: CoverageAddress[] = [];
  for (const item of parsed) {
    const row = asAddress(item);
    if (row) rows.push(row);
  }
  return rows;
}

export function parseOpsAddress(raw: string | undefined): CoverageAddress | null {
  if (!raw || !raw.trim()) return null;
  try {
    return asAddress(JSON.parse(raw));
  } catch {
    return null;
  }
}

function asAddress(value: unknown): CoverageAddress | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<CoverageAddress>;
  if (typeof row.postalCode !== 'string' || typeof row.street !== 'string' || typeof row.city !== 'string') {
    return null;
  }
  const postalCode = normalizePostal(row.postalCode);
  if (!postalCode || !row.street.trim() || !row.city.trim()) return null;
  return {
    postalCode,
    street: row.street.trim(),
    city: row.city.trim(),
    ...(typeof row.number === 'string' && row.number.trim() ? { number: row.number.trim() } : {}),
  };
}

/** Latest search for a cotoId replaces the older one. Other ids stay. */
export function mergeDiaPair(pairs: readonly DiaPair[], next: DiaPair): DiaPair[] {
  return [...pairs.filter((pair) => pair.cotoId !== next.cotoId), { ...next }];
}

/**
 * A stamped snapshot can only be rewritten by that same address.
 * A guest, or a different wallet, does not clear the buyer.
 */
export function freezeAllowed(current: CotoRealDia | undefined, owner: string | null): boolean {
  if (!current?.buyer) return true;
  return current.buyer === owner;
}

export function freezeCotoReal(
  current: CotoRealDia | undefined,
  pairs: readonly DiaPair[],
  owner: string | null,
): { ok: true; snapshot: CotoRealDia } | { ok: false; error: string } {
  if (!freezeAllowed(current, owner)) {
    return { ok: false, error: 'The basket belongs to another account. Nothing was changed.' };
  }
  const snapshot: CotoRealDia = { pairs: pairs.map((pair) => ({ ...pair })) };
  if (owner) snapshot.buyer = owner;
  return { ok: true, snapshot };
}

export function quoteBuyerError(snapshot: CotoRealDia | undefined, address: string): string | undefined {
  if (!snapshot) return 'Volvé a comparar antes de pagar.';
  if (!snapshot.buyer) return 'Confirmá Coto de nuevo con la sesión iniciada.';
  if (snapshot.buyer !== address) return 'Este changuito está asociado a otra cuenta.';
  return undefined;
}

function times(left: number, right: number): number | undefined {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return undefined;
  const product = left * right;
  if (!Number.isSafeInteger(product)) return undefined;
  return product;
}

/**
 * Lock = Coto ticket + fee on matched line subtotals.
 * `clientTotalCentavos` is accepted so a caller can pass the browser total
 * and a test can show it was not used.
 */
export function quoteFromPriced(args: {
  lines: readonly PricedLine[];
  clientTotalCentavos: number;
  pairs: readonly DiaPair[];
  postalCode: string;
  coverage: 'ops' | 'table';
}): { ok: true; quote: CotoRealQuote } | { ok: false; error: string } {
  void args.clientTotalCentavos;
  if (args.lines.length === 0) return { ok: false, error: 'El changuito está vacío.' };
  const rows: ComparisonRow[] = [];
  let ticket = 0;
  for (const line of args.lines) {
    if (!line.available) return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
    }
    if (!Number.isSafeInteger(line.unitCentavos) || line.unitCentavos <= 0) {
      return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
    }
    const lineTotal = times(line.unitCentavos, line.quantity);
    if (lineTotal === undefined) return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
    ticket += lineTotal;
    if (!Number.isSafeInteger(ticket)) return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
    const pair = args.pairs.find((item) => item.cotoId === line.skuId);
    const diaLine = pair ? times(pair.diaCentavos, line.quantity) : 0;
    if (diaLine === undefined) return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
    rows.push({
      skuId: line.skuId,
      name: line.name,
      quantity: line.quantity,
      diaLineCentavos: pair ? diaLine : 0,
      confidence: pair ? pair.confidence : 'none',
      ...(pair
        ? {
            coto: {
              id: line.skuId,
              name: line.name,
              shelfCentavos: line.unitCentavos,
              lineCentavos: lineTotal,
              available: true,
            },
          }
        : {}),
    });
  }
  let totals;
  try {
    totals = comparisonTotals(rows);
  } catch {
    return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
  }
  const lock = ticket + totals.feeCentavos;
  if (!Number.isSafeInteger(lock)) return { ok: false, error: 'No pudimos cotizar un producto de Coto.' };
  const matched = rows.some(countsTowardFee);
  const feeBasis: FeeBasis = totals.feeCentavos === 0 && !matched ? 'no_refs' : 'gap';
  return {
    ok: true,
    quote: {
      checkoutKind: COTO_REAL_KIND,
      postalCode: args.postalCode,
      coverage: args.coverage,
      cotoTicketCentavos: ticket,
      diaMatchedCentavos: totals.diaSubtotalCentavos,
      gapCentavos: Math.abs(totals.diaSubtotalCentavos - totals.otherSubtotalCentavos),
      feeCentavos: totals.feeCentavos,
      feeBasis,
      lockCentavos: lock,
    },
  };
}

export function refundRequired(reason: string): boolean {
  return REFUND_REASONS.has(reason);
}

/** The full lock, ticket plus fee. Undefined when this reason does not refund. */
export function refundAmount(lockCentavos: number, reason: string): number | undefined {
  if (!refundRequired(reason)) return undefined;
  if (!Number.isSafeInteger(lockCentavos) || lockCentavos < 0) return undefined;
  return lockCentavos;
}

const HIDDEN_STATUS = new Set(['viewerUrl', 'adminViewerUrl', 'ticket', 'formUrl', 'formUrls']);

export function shopperStatus<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!HIDDEN_STATUS.has(key)) out[key] = value;
  }
  return out;
}

/** Railway sandbox log only. Never a field on the shopper status. */
export function av5LogLine(url: string): string {
  return `av5 novnc ${url}`;
}

export function deliveryBeforeShop(phases: readonly string[]): boolean {
  const delivery = phases.indexOf('delivery');
  const shop = phases.indexOf('shop');
  return delivery !== -1 && shop !== -1 && delivery < shop;
}

export interface PayBlock {
  id: string;
  kind: string;
  retailer?: string;
}

/** The latest Coto cart after the latest user message, and only when admitted. */
export function cotoPayTarget(blocks: readonly PayBlock[], allowed: boolean): string | undefined {
  if (!allowed) return undefined;
  let start = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i]?.kind === 'user') start = i + 1;
  }
  let id: string | undefined;
  for (let i = start; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block?.kind === 'cart' && block.retailer === 'coto') id = block.id;
  }
  return id;
}

export function decodeDiaPairs(value: unknown): DiaPair[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs: DiaPair[] = [];
  for (const raw of value) {
    const pair = asPair(raw);
    if (pair) pairs.push(pair);
  }
  return pairs.length ? pairs : undefined;
}

export function decodeCotoRealDia(value: unknown): CotoRealDia | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as { pairs?: unknown; buyer?: unknown };
  const pairs = decodeDiaPairs(row.pairs) ?? [];
  if (!pairs.length && typeof row.buyer !== 'string') return undefined;
  const snapshot: CotoRealDia = { pairs };
  if (typeof row.buyer === 'string' && row.buyer.trim()) snapshot.buyer = row.buyer;
  return snapshot;
}

function asPair(value: unknown): DiaPair | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Partial<DiaPair>;
  if (typeof row.cotoId !== 'string' || typeof row.diaSkuId !== 'string') return undefined;
  if (row.confidence !== 'ean' && row.confidence !== 'brand_size_unit') return undefined;
  if (!Number.isSafeInteger(row.diaCentavos) || (row.diaCentavos ?? 0) <= 0) return undefined;
  return {
    cotoId: row.cotoId,
    diaSkuId: row.diaSkuId,
    diaCentavos: row.diaCentavos as number,
    confidence: row.confidence,
  };
}
