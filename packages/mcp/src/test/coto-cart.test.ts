import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addCotoLines, priceCotoCart, setCotoQuantity, type CotoPricer } from '../catalog/coto-cart.js';
import type { CatalogItem } from '../catalog/coto.js';

function item(id: string, centavos: number, name = 'Yerba'): CatalogItem {
  return {
    id,
    name,
    shelfPrice: { centavos, display: `$${(centavos / 100).toFixed(2)}` },
    priceSource: 'store_200',
    available: true,
  };
}

function catalog(rows: Record<string, CatalogItem | null>): CotoPricer {
  return {
    async getProduct(id) {
      return rows[id] ?? null;
    },
  };
}

describe('coto cart', () => {
  it('prices every line from the catalog and rejects an id that does not resolve', async () => {
    const lines = addCotoLines([], [
      { id: 'c1', quantity: 2 },
      { id: 'c1', quantity: 1 },
    ]);
    assert.deepEqual(lines, [{ id: 'c1', quantity: 3 }]);
    const cart = await priceCotoCart('coto-1', lines, catalog({ c1: item('c1', 1000) }));
    assert.equal(cart.retailer, 'coto');
    assert.equal(cart.cartId, 'coto-1');
    assert.equal(cart.lines[0]?.quantity, 3);
    assert.equal(cart.lines[0]?.lineTotal.centavos, 3000);
    assert.equal(cart.total.centavos, 3000);
    assert.equal(cart.lines[0]?.name, 'Yerba');
    await assert.rejects(
      () => priceCotoCart('coto-1', [{ id: 'dia-sku', quantity: 1 }], catalog({})),
      /exact catalog match/,
    );
  });

  it('removes a line at quantity 0 and renumbers the rest', async () => {
    const lines = setCotoQuantity(
      [
        { id: 'a', quantity: 1 },
        { id: 'b', quantity: 2 },
      ],
      0,
      0,
    );
    assert.deepEqual(lines, [{ id: 'b', quantity: 2 }]);
    const cart = await priceCotoCart('coto-2', lines, catalog({ b: item('b', 500, 'Arroz') }));
    assert.equal(cart.lines.length, 1);
    assert.equal(cart.lines[0]?.index, 0);
    assert.equal(cart.lines[0]?.skuId, 'b');
  });
});
