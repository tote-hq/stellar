import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareBasket, compareDiaToCoto, type CompareLine, type DiaCatalog } from '../catalog/compare.js';
import { compareLinesForCard } from '../catalog/compare-card.js';
import { toCatalogItem, type CatalogItem, type CotoSearchHit } from '../catalog/coto.js';
import type { CotoSearcher } from '../catalog/match.js';

function item(name: string, data: NonNullable<CotoSearchHit['data']> = {}): CatalogItem {
  const built = toCatalogItem({
    value: name,
    data: {
      id: 'coto-1',
      price: [{ store: '200', listPrice: 80 }],
      product_list_price: 80,
      store_availability: ['200'],
      url: '/product/leche',
      ...data,
    },
  });
  assert.ok(built, name);
  return built;
}

function line(partial: Partial<CompareLine> = {}): CompareLine {
  return {
    skuId: 'sku-1',
    name: 'Leche entera La Serenisima 1 L',
    quantity: 1,
    lineTotal: { centavos: 10_000 },
    ...partial,
  };
}

function dia(ean?: string): DiaCatalog {
  return {
    async getProduct() {
      return ean ? { ean, brand: 'La Serenisima' } : { brand: 'La Serenisima' };
    },
  };
}

function searcher(items: CatalogItem[]): CotoSearcher {
  return { async search() { return items; } };
}

describe('compareLinesForCard', () => {
  it('keeps a finished row when the signal aborts and does not invent the rest', async () => {
    const already = await compareLinesForCard([line()], dia('7790000000001'), searcher([]), AbortSignal.abort());
    assert.equal(already.status, 'timed_out');
    assert.equal(already.rows.length, 0);
    assert.equal(already.gap, undefined);

    const ctrl = new AbortController();
    const result = await compareLinesForCard(
      [line({ skuId: 'a' }), line({ skuId: 'b', name: 'Yerba 500 g' })],
      {
        async getProduct(skuId: string) {
          if (skuId === 'b') {
            ctrl.abort();
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          }
          return { ean: '7790000000001', brand: 'La Serenisima' };
        },
      },
      searcher([item('Otra leche 1 L', { id: 'ean-hit', product_main_ean: '7790000000001' })]),
      ctrl.signal,
    );
    assert.equal(result.status, 'timed_out');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.skuId, 'a');
    assert.equal(result.rows[0]?.coto?.lineCentavos, 8_000);
    assert.equal(JSON.stringify(result).includes('"lineCentavos":0'), false);
    assert.equal(JSON.stringify(result).includes('"shelfCentavos":0'), false);
  });

  it('gives a failed line no Coto price and no zero', async () => {
    const result = await compareLinesForCard(
      [line({ skuId: 'a' }), line({ skuId: 'b', name: 'Yerba 500 g' })],
      {
        async getProduct(skuId: string) {
          if (skuId === 'b') throw new Error('dia down');
          return { ean: '7790000000001', brand: 'La Serenisima' };
        },
      },
      searcher([item('Otra leche 1 L', { product_main_ean: '7790000000001' })]),
    );
    assert.equal(result.status, 'degraded');
    assert.equal(result.rows[1]?.confidence, 'failed');
    assert.equal(result.rows[1]?.coto, undefined);
    assert.equal(JSON.stringify(result).includes('"lineCentavos":0'), false);
    assert.equal(JSON.stringify(result).includes('"shelfCentavos":0'), false);
  });

  it('reports the absolute gap, not 20% of it', async () => {
    const result = await compareLinesForCard(
      [line()],
      dia('7790000000001'),
      searcher([item('Otra leche 1 L', { product_main_ean: '7790000000001' })]),
    );
    assert.equal(result.status, 'ok');
    assert.equal(result.gap?.diaSubtotalCentavos, 10_000);
    assert.equal(result.gap?.cotoSubtotalCentavos, 8_000);
    assert.equal(result.gap?.gapCentavos, 2_000);
    assert.notEqual(result.gap?.gapCentavos, 400);
    assert.equal('feeCentavos' in result, false);
    assert.equal(result.rows[0]?.coto?.url, 'https://www.coto.com.ar/product/leche');
  });

  it('omits the gap when nothing countable finished, and omits a link when the hit has no url', async () => {
    const none = await compareLinesForCard([line()], dia('7790000000001'), searcher([]));
    assert.equal(none.status, 'ok');
    assert.equal(none.gap, undefined);
    assert.equal(none.rows[0]?.coto, undefined);

    const noUrl = item('Otra leche 1 L', { product_main_ean: '7790000000001', url: '' });
    delete noUrl.url;
    const bare = await compareLinesForCard([line()], dia('7790000000001'), searcher([noUrl]));
    assert.equal(bare.rows[0]?.coto?.url, undefined);
    assert.equal(bare.gap?.gapCentavos, 2_000);
  });

  it('compareDiaToCoto still throws on a lookup failure', async () => {
    await assert.rejects(
      () => compareBasket([line()], { async getProduct() { throw new Error('dia down'); } }, searcher([])),
      /dia down/,
    );
    assert.match(compareDiaToCoto.toString(), /compareBasket/);
    const card = await compareLinesForCard(
      [line()],
      { async getProduct() { throw new Error('dia down'); } },
      searcher([]),
    );
    assert.equal(card.status, 'degraded');
    assert.equal(card.rows[0]?.coto, undefined);
  });
});
