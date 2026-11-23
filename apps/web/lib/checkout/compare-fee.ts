/**
 * Fee on the absolute gap between similar product subtotals.
 * Shipping is not an input. An available EAN or brand+size match counts
 * (similars, not EAN-only). Fee may be 0 when the gap is 0.
 * No imports: the checkout tests load this file by stripping types.
 */

export interface ComparisonRow {
  skuId: string;
  name: string;
  quantity: number;
  diaLineCentavos: number;
  confidence: 'ean' | 'brand_size_unit' | 'none';
  coto?: {
    id: string;
    name: string;
    shelfCentavos: number;
    lineCentavos: number;
    available: boolean;
  };
}

export interface ComparisonTotals {
  diaSubtotalCentavos: number;
  otherSubtotalCentavos: number;
  savingsCentavos: number;
  feeCentavos: number;
}

export type FeeBasis = 'gap' | 'no_refs' | 'timeout' | 'other_disabled' | 'compare_failed';

export interface ComparisonQuote extends ComparisonTotals {
  /** US cents added on top of the Día basket. Zero when the fee is zero. */
  feeUsdCents: number;
  rows: ComparisonRow[];
  feeBasis?: FeeBasis;
}

/** Similar available Coto lines: EAN or brand+size. Fee may still be 0. */
export function countsTowardFee(row: ComparisonRow): boolean {
  return (
    (row.confidence === 'ean' || row.confidence === 'brand_size_unit') &&
    row.coto?.available === true
  );
}

/**
 * Nearest integer. A remainder of exactly half the divisor rounds away from zero.
 * Half a centavo is remainder 50 when the divisor is 100.
 */
export function roundHalfAway(numerator: number, divisor: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(divisor) || divisor <= 0) {
    throw new Error('invalid rounding');
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const whole = Math.trunc(abs / divisor);
  const remainder = abs % divisor;
  return sign * (whole + (remainder * 2 >= divisor ? 1 : 0));
}

/** 20% of the gap, in centavos. */
export function feeCentavosOf(savingsCentavos: number): number {
  if (!Number.isSafeInteger(savingsCentavos) || savingsCentavos < 0) throw new Error('invalid savings');
  return roundHalfAway(savingsCentavos * 20, 100);
}

export function comparisonTotals(rows: readonly ComparisonRow[]): ComparisonTotals {
  let diaSubtotalCentavos = 0;
  let otherSubtotalCentavos = 0;
  for (const row of rows) {
    if (!countsTowardFee(row)) continue;
    const dia = row.diaLineCentavos;
    const other = row.coto?.lineCentavos ?? 0;
    if (!Number.isSafeInteger(dia) || dia < 0 || !Number.isSafeInteger(other) || other < 0) {
      throw new Error('invalid line');
    }
    diaSubtotalCentavos += dia;
    otherSubtotalCentavos += other;
  }
  const savingsCentavos = Math.abs(diaSubtotalCentavos - otherSubtotalCentavos);
  return {
    diaSubtotalCentavos,
    otherSubtotalCentavos,
    savingsCentavos,
    feeCentavos: feeCentavosOf(savingsCentavos),
  };
}

/**
 * US cents for the fee at the quote's rate. A zero fee does not call the converter,
 * so a helper that refuses 0 is never handed 0.
 */
export function feeUsdFrom(feeCentavos: number, toUsdCents: (centavos: number) => number): number {
  if (feeCentavos === 0) return 0;
  if (!Number.isSafeInteger(feeCentavos) || feeCentavos < 0) throw new Error('invalid fee');
  const usd = toUsdCents(feeCentavos);
  if (!Number.isSafeInteger(usd) || usd < 0) throw new Error('invalid fee usd');
  return usd;
}
