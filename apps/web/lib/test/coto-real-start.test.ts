import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { checkoutStore, type CheckoutRecord } from '../checkout/store.ts';

delete process.env.DATABASE_URL;

const ORDER = 'ab'.repeat(32);
const BASKET = 'cd'.repeat(32);
const BUYER = 'GBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYER';
const SENTINEL = 'SENTINEL-CARD-VALUE';

function record(): CheckoutRecord {
  return {
    checkoutKind: 'coto_real_v1',
    orderId: ORDER,
    buyer: BUYER,
    amount: '10000000',
    amountCents: 1000,
    basketHash: BASKET,
    arsPerUsd: 1000,
    totalDisplay: '247420',
    retailer: 'coto',
    lines: [{ name: 'Leche', skuId: 'sku-1', quantity: 1, lineTotal: '247400' }],
    handoffUrl: null,
    createdAt: Date.now(),
    mode: 'live',
    fulfillment: 'pickup',
    city: 'CABA',
  };
}

describe('coto real start', () => {
  after(async () => {
    const { __setCotoRealStartForTests } = await import('../checkout/coto-real-start.ts');
    __setCotoRealStartForTests(null);
  });

  it('stores the sandbox job id when no card row exists', async () => {
    const { startCotoRealCheckout, __setCotoRealStartForTests } = await import('../checkout/coto-real-start.ts');
    const calls: unknown[] = [];
    __setCotoRealStartForTests({
      readOrder: async () => ({
        buyer: BUYER,
        status: 'open',
        amount: 10_000_000n,
        basketHash: BASKET,
      }),
      catalog: async () => null,
      starter: async (orderId, items, input) => {
        calls.push({ orderId, items, input });
        return 'job-real-1';
      },
    });
    const rec = record();
    const res = await startCotoRealCheckout(rec, 'sig');
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    const sent = calls[0] as { input: Record<string, unknown> };
    assert.equal('card' in sent.input, false);
    assert.equal(JSON.stringify(calls).includes(SENTINEL), false);
    assert.equal(JSON.stringify(calls).includes('pan'), false);
    assert.equal(rec.jobId, 'job-real-1');
    assert.notEqual(rec.jobId, 'none');
    assert.equal(rec.error, undefined);
    const stored = await checkoutStore().get(ORDER);
    assert.equal(stored?.jobId, 'job-real-1');
    assert.equal(stored?.error, undefined);
    const body = await res.json();
    assert.equal(JSON.stringify(body).includes(SENTINEL), false);
    assert.equal(body.stage, 'shopping');
  });

  it('sends the catalog url when the exact product has one and leaves it out when it does not', async () => {
    const { startCotoRealCheckout, __setCotoRealStartForTests } = await import('../checkout/coto-real-start.ts');
    const calls: { items: { name: string; sku: string; url?: string }[] }[] = [];
    __setCotoRealStartForTests({
      readOrder: async () => ({
        buyer: BUYER,
        status: 'open',
        amount: 10_000_000n,
        basketHash: BASKET,
      }),
      catalog: async (skuId) => {
        if (skuId === 'sku-1') return { url: 'https://www.coto.com.ar/product/leche' };
        if (skuId === 'sku-blank') return { url: '   ' };
        if (skuId === 'sku-down') throw new Error('catalog down');
        return null;
      },
      starter: async (_orderId, items) => {
        calls.push({ items });
        return 'job-urls';
      },
    });
    const rec = record();
    rec.orderId = '12'.repeat(32);
    rec.lines = [
      { name: 'Leche', skuId: 'sku-1', quantity: 1, lineTotal: '100' },
      { name: 'Manteca TONADITA 100 g', skuId: 'sku-2', quantity: 1, lineTotal: '100' },
      { name: 'Pan', skuId: 'sku-blank', quantity: 1, lineTotal: '100' },
      { name: 'Huevos', skuId: 'sku-down', quantity: 1, lineTotal: '100' },
    ];
    const res = await startCotoRealCheckout(rec, 'sig');
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    const items = calls[0]!.items;
    assert.equal(items[0]?.url, 'https://www.coto.com.ar/product/leche');
    assert.equal('url' in items[1]!, false);
    assert.equal('url' in items[2]!, false);
    assert.equal('url' in items[3]!, false);
    assert.equal(JSON.stringify(items).includes('/producto/'), false);
    assert.equal(JSON.stringify(items).includes('sku-2'), true);
  });

  it('still records jobId none when the sandbox start throws', async () => {
    const { startCotoRealCheckout, __setCotoRealStartForTests } = await import('../checkout/coto-real-start.ts');
    __setCotoRealStartForTests({
      readOrder: async () => ({
        buyer: BUYER,
        status: 'open',
        amount: 10_000_000n,
        basketHash: BASKET,
      }),
      catalog: async () => null,
      starter: async () => {
        throw new Error('sandbox answered 422');
      },
    });
    const rec = record();
    rec.orderId = 'ef'.repeat(32);
    const res = await startCotoRealCheckout(rec, undefined);
    assert.equal(res.status, 200);
    assert.equal(rec.jobId, 'none');
    assert.equal(rec.error, 'No pudimos arrancar la compra.');
    const stored = await checkoutStore().get(rec.orderId);
    assert.equal(stored?.jobId, 'none');
  });
});
