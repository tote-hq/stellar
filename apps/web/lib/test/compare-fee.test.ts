import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  comparisonTotals,
  countsTowardFee,
  feeCentavosOf,
  feeUsdFrom,
  roundHalfAway,
  type ComparisonRow,
} from '../checkout/compare-fee.ts';

function row(partial: Partial<ComparisonRow> & Pick<ComparisonRow, 'diaLineCentavos'>): ComparisonRow {
  const line = partial.coto?.lineCentavos ?? partial.diaLineCentavos;
  return {
    skuId: partial.skuId ?? 'sku',
    name: partial.name ?? 'Leche',
    quantity: partial.quantity ?? 1,
    diaLineCentavos: partial.diaLineCentavos,
    confidence: partial.confidence ?? 'ean',
    coto: partial.coto === undefined && partial.confidence === 'none'
      ? undefined
      : partial.coto ?? {
        id: 'coto',
        name: 'Leche',
        shelfCentavos: line,
        lineCentavos: line,
        available: true,
      },
  };
}

describe('compare fee', () => {
  it('charges 20% when Día is cheaper', () => {
    const totals = comparisonTotals([row({ diaLineCentavos: 800, coto: { id: 'c', name: 'Leche', shelfCentavos: 1000, lineCentavos: 1000, available: true } })]);
    assert.equal(totals.diaSubtotalCentavos, 800);
    assert.equal(totals.otherSubtotalCentavos, 1000);
    assert.equal(totals.savingsCentavos, 200);
    assert.equal(totals.feeCentavos, 40);
  });

  it('charges 20% of the same gap when Coto is cheaper', () => {
    const totals = comparisonTotals([row({ diaLineCentavos: 1000, coto: { id: 'c', name: 'Leche', shelfCentavos: 800, lineCentavos: 800, available: true } })]);
    assert.equal(totals.savingsCentavos, 200);
    assert.equal(totals.feeCentavos, 40);
  });

  it('charges nothing when the matched subtotals are equal', () => {
    const totals = comparisonTotals([row({ diaLineCentavos: 1500, coto: { id: 'c', name: 'Leche', shelfCentavos: 1500, lineCentavos: 1500, available: true } })]);
    assert.equal(totals.savingsCentavos, 0);
    assert.equal(totals.feeCentavos, 0);
  });

  it('charges nothing when no line is an EAN match', () => {
    const totals = comparisonTotals([
      row({ diaLineCentavos: 500, confidence: 'none', coto: undefined }),
    ]);
    assert.equal(totals.diaSubtotalCentavos, 0);
    assert.equal(totals.otherSubtotalCentavos, 0);
    assert.equal(totals.feeCentavos, 0);
  });

  it('leaves brand + size out of both subtotals and the fee', () => {
    const similar = row({
      skuId: 'similar',
      diaLineCentavos: 400,
      confidence: 'brand_size_unit',
      coto: { id: 's', name: 'Parecida', shelfCentavos: 100, lineCentavos: 100, available: true },
    });
    const exact = row({
      skuId: 'exact',
      diaLineCentavos: 1000,
      coto: { id: 'e', name: 'Igual', shelfCentavos: 800, lineCentavos: 800, available: true },
    });
    assert.equal(countsTowardFee(similar), false);
    const totals = comparisonTotals([similar, exact]);
    assert.equal(totals.diaSubtotalCentavos, 1000);
    assert.equal(totals.otherSubtotalCentavos, 800);
    assert.equal(totals.savingsCentavos, 200);
    assert.equal(totals.feeCentavos, 40);
  });

  it('leaves an unavailable Coto row out', () => {
    const totals = comparisonTotals([
      row({
        diaLineCentavos: 1000,
        coto: { id: 'c', name: 'Leche', shelfCentavos: 100, lineCentavos: 100, available: false },
      }),
    ]);
    assert.equal(totals.diaSubtotalCentavos, 0);
    assert.equal(totals.otherSubtotalCentavos, 0);
    assert.equal(totals.feeCentavos, 0);
  });

  it('sums extended line totals and does not multiply quantity again', () => {
    const totals = comparisonTotals([
      row({
        quantity: 3,
        diaLineCentavos: 3000,
        coto: { id: 'c', name: 'Leche', shelfCentavos: 900, lineCentavos: 2700, available: true },
      }),
    ]);
    assert.equal(totals.diaSubtotalCentavos, 3000);
    assert.equal(totals.otherSubtotalCentavos, 2700);
    assert.equal(totals.savingsCentavos, 300);
    assert.equal(totals.feeCentavos, 60);
  });

  it('rounds at the half centavo', () => {
    assert.equal(roundHalfAway(49, 100), 0);
    assert.equal(roundHalfAway(50, 100), 1);
    assert.equal(roundHalfAway(150, 100), 2);
    assert.equal(feeCentavosOf(2), 0);
    assert.equal(feeCentavosOf(3), 1);
    assert.equal(feeCentavosOf(5), 1);
    assert.equal(feeCentavosOf(8), 2);
  });

  it('does not price a zero fee', () => {
    let calls = 0;
    assert.equal(feeUsdFrom(0, () => {
      calls += 1;
      return 9;
    }), 0);
    assert.equal(calls, 0);
  });

  it('asks the rate for a non-zero fee and keeps the rounded-up cents', () => {
    const seen: number[] = [];
    const usd = feeUsdFrom(100, (centavos) => {
      seen.push(centavos);
      return Math.ceil((centavos / 100 / 1450) * 100);
    });
    assert.deepEqual(seen, [100]);
    assert.equal(usd, 1);
  });
});
