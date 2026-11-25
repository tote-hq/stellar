/**
 * A Día basket compared for the chat card.
 *
 * `compareBasket` still rejects the whole basket on any lookup failure, because
 * a partial quote would understate the fee. This path is the opposite: a failed
 * line or a timeout keeps what finished and never invents a Coto price of 0.
 * The card shows a difference. It does not price a fee.
 */
import type { Product } from '../types.js';
import { absoluteUrl, discoverPublicKey } from './coto.js';
import type { CompareLine, CompareRunOpts, DiaCatalog } from './compare.js';
import { matchDiaToCoto, type CotoSearcher, type MatchConfidence } from './match.js';

export type CardConfidence = MatchConfidence | 'failed';

export interface CardCoto {
  id: string;
  name: string;
  shelfCentavos: number;
  lineCentavos: number;
  available: boolean;
  url?: string;
}

export interface CardRow {
  skuId: string;
  name: string;
  quantity: number;
  diaLineCentavos: number;
  confidence: CardConfidence;
  /** Present only when a positive Coto price was read. Never 0. */
  coto?: CardCoto;
}

export interface CardGap {
  diaSubtotalCentavos: number;
  cotoSubtotalCentavos: number;
  gapCentavos: number;
}

export interface CardCompare {
  status: 'ok' | 'degraded' | 'timed_out';
  rows: CardRow[];
  matched: number;
  /** How many lines were asked for, including ones that did not finish. */
  lines: number;
  /** Absent when no available EAN match finished. Never 0 as a stand-in. */
  gap?: CardGap;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * A Día read or a Coto search that never observes `signal` must not hold the
 * card. This settles when the lookup finishes or when the signal aborts,
 * whichever is first. A lookup that loses the race keeps running; its later
 * result is ignored and a later rejection is swallowed.
 */
function untilAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  const pending = Promise.resolve(work);
  void pending.catch(() => undefined);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let closed = false;
    const onAbort = () => {
      if (closed) return;
      closed = true;
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        if (closed) return;
        closed = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (closed) return;
        closed = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function failedRow(line: CompareLine): CardRow {
  return {
    skuId: line.skuId,
    name: line.name,
    quantity: line.quantity,
    diaLineCentavos: line.lineTotal.centavos,
    confidence: 'failed',
  };
}

function lineOk(line: CompareLine): boolean {
  return Boolean(line.skuId && line.name)
    && Number.isSafeInteger(line.quantity) && line.quantity > 0
    && Number.isSafeInteger(line.lineTotal?.centavos) && line.lineTotal.centavos >= 0;
}

async function matchRow(
  line: CompareLine,
  product: Pick<Product, 'brand' | 'ean'>,
  coto: CotoSearcher,
): Promise<CardRow> {
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
  const row: CardRow = {
    skuId: line.skuId,
    name: line.name,
    quantity: line.quantity,
    diaLineCentavos: line.lineTotal.centavos,
    confidence: found.confidence,
  };
  if (!found.match || found.confidence === 'none') return row;

  const shelfCentavos = found.match.shelfPrice.centavos;
  const lineCentavos = shelfCentavos * line.quantity;
  if (!Number.isSafeInteger(shelfCentavos) || shelfCentavos <= 0) return row;
  if (!Number.isSafeInteger(lineCentavos) || lineCentavos <= 0) return row;

  const offer: CardCoto = {
    id: found.match.id,
    name: found.match.name,
    shelfCentavos,
    lineCentavos,
    available: found.match.available,
  };
  const url = absoluteUrl(found.match.url);
  if (url) offer.url = url;
  row.coto = offer;
  return row;
}

/** Available EAN matches only. The same rows a fee would count, without the fee. */
function gapOf(rows: readonly CardRow[]): CardGap | undefined {
  let diaSubtotalCentavos = 0;
  let cotoSubtotalCentavos = 0;
  let counted = 0;
  for (const row of rows) {
    if (row.confidence !== 'ean' || row.coto?.available !== true) continue;
    const other = row.coto.lineCentavos;
    const dia = row.diaLineCentavos;
    if (!Number.isSafeInteger(dia) || dia < 0 || !Number.isSafeInteger(other) || other <= 0) continue;
    diaSubtotalCentavos += dia;
    cotoSubtotalCentavos += other;
    counted += 1;
  }
  if (counted === 0) return undefined;
  return {
    diaSubtotalCentavos,
    cotoSubtotalCentavos,
    gapCentavos: Math.abs(diaSubtotalCentavos - cotoSubtotalCentavos),
  };
}

function finish(lines: number, rows: CardRow[], aborted: boolean, failed: boolean): CardCompare {
  const gap = gapOf(rows);
  const result: CardCompare = {
    status: aborted ? 'timed_out' : failed ? 'degraded' : 'ok',
    rows,
    matched: rows.filter((row) => row.coto !== undefined && row.coto.lineCentavos > 0).length,
    lines,
  };
  if (gap) result.gap = gap;
  return result;
}

/**
 * One row per line that finished. A lookup error becomes a failed row with no
 * Coto price. An abort keeps the rows already finished, adds nothing for the
 * line still in flight, and returns. It does not throw.
 */
export async function compareLinesForCard(
  lines: readonly CompareLine[],
  dia: DiaCatalog,
  coto: CotoSearcher,
  signal?: AbortSignal,
): Promise<CardCompare> {
  const rows: CardRow[] = [];
  let failed = false;
  for (const line of lines) {
    if (signal?.aborted) return finish(lines.length, rows, true, failed);
    if (!lineOk(line)) {
      failed = true;
      rows.push(failedRow(line));
      continue;
    }
    try {
      const product = await untilAbort(dia.getProduct(line.skuId), signal);
      if (signal?.aborted) return finish(lines.length, rows, true, failed);
      if (!product) {
        failed = true;
        rows.push(failedRow(line));
        continue;
      }
      const row = await untilAbort(matchRow(line, product, coto), signal);
      rows.push(row);
      if (signal?.aborted) return finish(lines.length, rows, true, failed);
    } catch (error) {
      if (isAbort(error, signal)) return finish(lines.length, rows, true, failed);
      failed = true;
      rows.push(failedRow(line));
    }
  }
  return finish(lines.length, rows, false, failed);
}

/**
 * The chat card's entry. A missing or aborted lookup does not reject the basket.
 * The call settles when `signal` aborts, even if that lookup ignores the signal.
 * `compareDiaToCoto` stays the quote path.
 */
export async function compareForCard(
  lines: readonly CompareLine[],
  postalCode: string,
  opts?: CompareRunOpts,
): Promise<CardCompare> {
  const { diaLookup, cotoSearcher } = await import('./compare.js');
  void discoverPublicKey().catch(() => undefined);
  return compareLinesForCard(lines, diaLookup(postalCode), cotoSearcher(), opts?.signal);
}
