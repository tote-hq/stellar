import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Cart, Product } from '@changuito/mcp/types';

import type { Turn } from '../agent/loop.ts';
import { turnStoreAt } from '../agent/turn-store.ts';
import { startKvStandIn, type KvStandIn } from './kv-stand-in.ts';

const money = (centavos: number) => ({ centavos, display: `$${(centavos / 100).toFixed(2)}` });

const product = (skuId: string, name: string): Product => ({
  skuId,
  productId: `p-${skuId}`,
  name,
  sellerId: '1',
  price: money(100),
  available: true,
});

function sampleTurn(): Turn {
  const cart: Cart = {
    retailer: 'dia',
    cartId: 'cart-1',
    lines: [],
    total: money(0),
    messages: [],
  };
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'leche' }] }],
    cache: {
      products: new Map<string, Product>([['1', product('1', 'Leche')]]),
      cart,
      handoffUrl: 'https://example.com/cart',
      handoffFor: 'cart-1',
      drawn: 'cart-1',
    },
  };
}

/**
 * The session store against a real Redis, reached the same way Vercel KV is:
 * the Upstash REST client. Skips when Docker is not available.
 */
describe('turn store against a Redis stand-in for Vercel KV', () => {
  let kv: KvStandIn | undefined;

  before(async () => {
    kv = await startKvStandIn();
  });

  after(async () => {
    await kv?.stop();
  });

  it('round-trips a conversation, including the product Map', async (t) => {
    if (!kv) {
      t.skip('Docker is not available');
      return;
    }

    const store = turnStoreAt(kv.url, kv.token);
    assert.equal(store.kind, 'redis');

    await store.set('session-a', sampleTurn());
    const back = await store.get('session-a');

    assert.ok(back);
    assert.ok(back.cache.products instanceof Map);
    assert.equal(back.cache.products.get('1')?.name, 'Leche');
    assert.equal(back.cache.cart?.cartId, 'cart-1');
    assert.equal(back.cache.handoffUrl, 'https://example.com/cart');
    assert.equal(back.cache.handoffFor, 'cart-1');
    assert.equal(back.messages.length, 1);
    assert.equal(await store.get('session-b'), undefined);
  });
});
