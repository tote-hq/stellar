import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareBasket, type CompareLine, type DiaCatalog } from '../catalog/compare.js';
import { toCatalogItem, type CatalogItem, type CotoSearchHit } from '../catalog/coto.js';
import type { CotoSearcher } from '../catalog/match.js';

function item(name: string, data: NonNullable<CotoSearchHit['data']> = {}): CatalogItem {
  const built = toCatalogItem({
    value: name,
    data: {
      id: 'coto-1',
      price: [{ store: '200', listPrice: 10 }],
      product_list_price: 10,
      store_availability: ['200'],
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
    lineTotal: { centavos: 1200 },
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

function searcher(items: CatalogItem[], calls: string[] = []): CotoSearcher {
  return {
    async search(query: string) {
      calls.push(query);
      return items;
    },
  };
}

describe('compareBasket', () => {
  it('prices an EAN match at shelf times quantity', async () => {
    const calls: string[] = [];
    const rows = await compareBasket(
      [line({ quantity: 2, lineTotal: { centavos: 2400 } })],
      dia('7790000000001'),
      searcher([item('Otra leche 1 L', { id: 'ean-hit', product_main_ean: '7790000000001' })], calls),
    );
    assert.deepEqual(calls, ['7790000000001']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.confidence, 'ean');
    assert.equal(rows[0]?.diaLineCentavos, 2400);
    assert.equal(rows[0]?.coto?.id, 'ean-hit');
    assert.equal(rows[0]?.coto?.shelfCentavos, 1000);
    assert.equal(rows[0]?.coto?.lineCentavos, 2000);
    assert.equal(rows[0]?.coto?.available, true);
  });

  it('keeps a brand + size match at lower confidence', async () => {
    const rows = await compareBasket(
      [line()],
      dia(),
      searcher([item('Leche entera 1 L', { id: 'brand-hit', product_brand: 'LA SERENISIMA', product_main_ean: '1000000000099' })]),
    );
    assert.equal(rows[0]?.confidence, 'brand_size_unit');
    assert.equal(rows[0]?.coto?.id, 'brand-hit');
    assert.equal(rows[0]?.coto?.lineCentavos, 1000);
  });

  it('returns no coto row when nothing matches', async () => {
    const rows = await compareBasket([line()], dia('7790000000001'), searcher([]));
    assert.equal(rows[0]?.confidence, 'none');
    assert.equal(rows[0]?.coto, undefined);
  });

  it('rejects the whole basket when Día or Coto cannot be read', async () => {
    const one = line();
    await assert.rejects(
      () => compareBasket([one], { async getProduct() { throw new Error('dia down'); } }, searcher([])),
      /dia down/,
    );
    await assert.rejects(
      () => compareBasket([one], { async getProduct() { return null; } }, searcher([])),
      /dia product missing/,
    );
    await assert.rejects(
      () => compareBasket([one], dia('7790000000001'), { async search() { throw new Error('coto down'); } }),
      /coto down/,
    );
    let second = false;
    await assert.rejects(
      () => compareBasket(
        [line({ skuId: 'a' }), line({ skuId: 'b', name: 'Yerba 500 g' })],
        {
          async getProduct(skuId: string) {
            if (skuId === 'b') {
              second = true;
              throw new Error('second failed');
            }
            return { ean: '7790000000001', brand: 'La Serenisima' };
          },
        },
        searcher([item('Otra 1 L', { product_main_ean: '7790000000001' })]),
      ),
      /second failed/,
    );
    assert.equal(second, true);
  });

  it('prefetches at most four Día products at once and keeps row order', async () => {
    let inFlight = 0;
    let max = 0;
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rows = await compareBasket(
      ids.map((skuId) => line({ skuId, name: `Leche ${skuId} 1 L` })),
      {
        async getProduct() {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 30));
          inFlight -= 1;
          return { ean: '7790000000001', brand: 'La Serenisima' };
        },
      },
      searcher([item('Otra leche 1 L', { product_main_ean: '7790000000001' })]),
    );
    assert.ok(max > 1);
    assert.ok(max <= 4);
    assert.deepEqual(rows.map((row) => row.skuId), ids);
  });

  it('does not start lookups when the signal is already aborted', async () => {
    let called = false;
    await assert.rejects(
      () => compareBasket(
        [line()],
        {
          async getProduct() {
            called = true;
            return { brand: 'La Serenisima' };
          },
        },
        searcher([]),
        AbortSignal.abort(),
      ),
      { name: 'AbortError' },
    );
    assert.equal(called, false);
  });
});
