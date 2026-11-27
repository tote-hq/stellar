import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { VtexAdapter } from '../adapters/vtex.js';

const originalFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function dia(): VtexAdapter {
  return new VtexAdapter({
    id: 'dia',
    displayName: 'Día',
    host: 'dia.test',
    locale: 'es-AR',
    salesChannel: '1',
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('VTEX regions use the four-digit postal code', () => {
  it('queries regions with the four-digit core of a CPA', async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return json([{ id: 'region-1414', sellers: [{ id: 'ardiaprod1080', name: 'Dia' }] }]);
    };
    const ctx = await dia().resolveLocation('C1414ABC');
    assert.equal(urls.length, 1);
    assert.match(urls[0] ?? '', /postalCode=1414/);
    assert.doesNotMatch(urls[0] ?? '', /C1414ABC/);
    assert.equal(ctx.postalCode, 'C1414ABC');
    assert.equal(ctx.regionId, 'region-1414');
    assert.equal(ctx.degraded, false);
    assert.equal(ctx.sellers[0]?.id, 'ardiaprod1080');
  });

  it('does not store a seller-less region', async () => {
    globalThis.fetch = async () => json([{ id: 'U1cj', sellers: [] }]);
    const ctx = await dia().resolveLocation('C1414ABC');
    assert.equal(ctx.postalCode, 'C1414ABC');
    assert.equal(ctx.regionId, undefined);
    assert.equal(ctx.degraded, true);
    assert.equal(ctx.sellers.length, 0);
    assert.match(ctx.note ?? '', /Día has no store that delivers to C1414ABC/);
    assert.doesNotMatch(ctx.note ?? '', /national defaults/);
  });

  it('returns no available products after a seller-less region', async () => {
    const stock = {
      products: [
        {
          productId: '1',
          productName: 'Arroz',
          items: [
            {
              itemId: 'sku-1',
              name: 'Arroz',
              sellers: [
                { sellerId: '1', commertialOffer: { Price: 1000, AvailableQuantity: 10000 } },
              ],
            },
          ],
        },
      ],
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('product-search')) return json(stock);
      return json([{ id: 'U1cj', sellers: [] }]);
    };
    const adapter = dia();
    const ctx = await adapter.resolveLocation('9410');
    assert.equal(ctx.undeliverable, true);
    assert.equal(ctx.regionId, undefined);
    const hits = await adapter.search('arroz', ctx);
    assert.equal(hits.length, 0);
  });

  it('keeps a bare code that has sellers', async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return json([{ id: 'region-1414', sellers: [{ id: 'ardiaprod1080' }] }]);
    };
    const ctx = await dia().resolveLocation('1414');
    assert.match(urls[0] ?? '', /postalCode=1414/);
    assert.equal(ctx.postalCode, '1414');
    assert.equal(ctx.regionId, 'region-1414');
    assert.equal(ctx.degraded, false);
    assert.equal(ctx.sellers.length, 1);
  });
});
