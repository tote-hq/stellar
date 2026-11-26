import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogItem } from '../catalog/coto.js';
import { assembleSearchCompare, searchCompare } from '../catalog/search-compare.js';
import type { Product } from '../types.js';

function dia(over: Partial<Product> = {}): Product {
  return {
    skuId: 'd1',
    productId: 'p1',
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean: '7790001',
    sellerId: '1',
    price: { centavos: 247500, display: '$2.475,00' },
    available: true,
    ...over,
  };
}

function coto(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'c1',
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean: '7790001',
    shelfPrice: { centavos: 229000, display: '$2.290,00' },
    priceSource: 'store_200',
    available: true,
    ...over,
  };
}

describe('searchCompare', () => {
  it('uses the first confident available pair and the absolute gap', async () => {
    const dearerCoto = coto({
      id: 'c-dear',
      ean: '7790002',
      shelfPrice: { centavos: 300000, display: '$3.000,00' },
    });
    const match = coto();
    const result = await searchCompare('leche', [dia(), dia({ skuId: 'd2', ean: '7790002', available: false })], {
      coto: { async search() { return [match, dearerCoto]; } },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.pair?.diaSkuId, 'd1');
    assert.equal(result.pair?.cotoId, 'c1');
    assert.equal(result.gapCentavos, Math.abs(247500 - 229000));

    const flipped = assembleSearchCompare({
      diaProducts: [dia({ price: { centavos: 1000, display: '$10,00' } })],
      diaFailed: false,
      coto: { ok: true, items: [coto({ shelfPrice: { centavos: 2500, display: '$25,00' } })] },
    });
    assert.equal(flipped.gapCentavos, 1500);
  });

  it('reports an empty, failed, or timed-out Coto lookup with no zero-price rows', () => {
    const products = [dia()];
    const empty = assembleSearchCompare({ diaProducts: products, diaFailed: false, coto: { ok: true, items: [] } });
    assert.equal(empty.status, 'coto_empty');
    assert.deepEqual(empty.coto, []);
    assert.equal(empty.gapCentavos, undefined);

    const failed = assembleSearchCompare({
      diaProducts: products,
      diaFailed: false,
      coto: { ok: false, reason: 'error' },
    });
    assert.equal(failed.status, 'coto_error');
    assert.deepEqual(failed.coto, []);

    const timed = assembleSearchCompare({
      diaProducts: products,
      diaFailed: false,
      coto: { ok: false, reason: 'timed_out' },
    });
    assert.equal(timed.status, 'coto_timed_out');
    assert.equal(timed.pair, undefined);
  });

  it('keeps Coto hits when Día failed and does not invent a gap', () => {
    const result = assembleSearchCompare({
      diaProducts: [],
      diaFailed: true,
      coto: { ok: true, items: [coto()] },
    });
    assert.equal(result.status, 'dia_error');
    assert.equal(result.coto.length, 1);
    assert.equal(result.gapCentavos, undefined);
  });

  it('skips a pair that is not available on both sides', () => {
    const result = assembleSearchCompare({
      diaProducts: [dia()],
      diaFailed: false,
      coto: { ok: true, items: [coto({ available: false })] },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.pair, undefined);
    assert.equal(result.gapCentavos, undefined);
  });
});
