import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Cart, Product } from '@changuito/mcp/types';

import { emptyCache, type RenderCache } from '../agent/render-tools.ts';
import { addCardToCart, parseCartAddBody, type CartAddCall, type CartAddSession } from '../cart-add.ts';

const SID = '11111111-1111-4111-8111-111111111111';

function product(skuId: string): Product {
  return {
    skuId,
    productId: 'p',
    name: 'Leche',
    sellerId: '9',
    price: { centavos: 999, display: '$9,99' },
    available: true,
  };
}

function basket(retailer: 'dia' | 'coto', skuId: string, centavos: number): Cart {
  return {
    retailer,
    cartId: retailer === 'coto' ? 'coto-11111111-1111-4111-8111-111111111111' : 'cart-1',
    lines: [
      {
        index: 0,
        skuId,
        name: 'Leche',
        quantity: 1,
        sellerId: '9',
        unitPrice: { centavos, display: '$' },
        lineTotal: { centavos, display: '$' },
        available: true,
      },
    ],
    total: { centavos, display: '$' },
    messages: [],
  };
}

function harness(opts: {
  order?: 'dia' | 'coto';
  cache?: RenderCache;
  compareOn?: boolean;
  cotoEnabled?: boolean;
  owner?: string | null;
}) {
  let order = opts.order;
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const session: CartAddSession = {
    state: {
      getOrder: () => order,
      getLocation: () => ({ retailer: 'dia' }),
      snapshot: () => ({ carts: {}, ...(order ? { order } : {}) }),
    },
  };
  const call = async (name: string, input: Record<string, unknown>): Promise<CartAddCall> => {
    calls.push({ name, input });
    if (name === 'choose_retailer') {
      order = input.retailer === 'coto' ? 'coto' : 'dia';
      return { isError: false, structured: undefined };
    }
    if (name === 'add_to_cart') {
      const sku = (input.items as { sku_id: string }[])[0]?.sku_id ?? '';
      const chain = order === 'coto' ? 'coto' : 'dia';
      return { isError: false, structured: { cart: basket(chain, sku, 247500) } };
    }
    if (name === 'get_cart_link') {
      const sku = calls.find((row) => row.name === 'add_to_cart');
      const id = sku ? ((sku.input.items as { sku_id: string }[])[0]?.sku_id ?? 'd1') : 'd1';
      return {
        isError: false,
        structured: { cart: basket('dia', id, 247500), handoffUrl: 'https://dia.example/cart' },
      };
    }
    return { isError: true };
  };
  return { calls, session, call, cache: opts.cache ?? emptyCache() };
}

describe('parseCartAddBody', () => {
  it('keeps the chain and the id and drops a client price', () => {
    const parsed = parseCartAddBody({
      sessionId: SID,
      chain: 'dia',
      id: 'd1',
      price: 1,
      name: 'Leche',
      quantity: 9,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.body.id, 'd1');
    assert.equal(parsed.body.chain, 'dia');
    assert.equal('price' in parsed.body, false);
    assert.equal('quantity' in parsed.body, false);
  });
});

describe('addCardToCart', () => {
  it('adds the known Día id at quantity 1 and prices the line on the server', async () => {
    const cache = emptyCache();
    cache.products.set('d1', product('d1'));
    const { calls, session, call } = harness({ order: 'dia', cache });
    const result = await addCardToCart({
      session,
      cache,
      chain: 'dia',
      id: 'd1',
      owner: null,
      compareOn: true,
      cotoEnabled: true,
      call,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0]?.input, { items: [{ sku_id: 'd1', quantity: 1, seller_id: '9' }] });
    assert.equal('price' in (calls[0]?.input ?? {}), false);
    if (!result.ok || !result.event) {
      assert.fail('expected a cart event');
    }
    assert.equal(result.event.t, 'cart');
    assert.equal(result.event.cart.lines[0]?.skuId, 'd1');
    assert.equal(result.event.cart.lines[0]?.quantity, 1);
    assert.equal(result.event.cart.lines[0]?.unitPrice.centavos, 247500);
    assert.equal(result.event.handoffUrl, 'https://dia.example/cart');
  });

  it('refuses an unknown id without calling the store', async () => {
    const { calls, session, call, cache } = harness({ order: 'dia' });
    const result = await addCardToCart({
      session,
      cache,
      chain: 'dia',
      id: 'missing',
      owner: null,
      compareOn: true,
      cotoEnabled: true,
      call,
    });
    assert.deepEqual(result, { ok: false, status: 400, error: 'unknown_product' });
    assert.equal(calls.length, 0);
  });

  it('refuses a Coto id on a Día order', async () => {
    const cache = emptyCache();
    cache.coto = { c9: { id: 'c9', name: 'Picada', shelfCentavos: 1000, available: true } };
    const { calls, session, call } = harness({ order: 'dia', cache });
    const result = await addCardToCart({
      session,
      cache,
      chain: 'dia',
      id: 'c9',
      owner: null,
      compareOn: true,
      cotoEnabled: true,
      call,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, 'foreign_cart');
    assert.equal(calls.length, 0);
  });

  it('refuses the other chain while that basket has lines', async () => {
    const cache = emptyCache();
    cache.coto = { c9: { id: 'c9', name: 'Picada', shelfCentavos: 1000, available: true } };
    cache.cart = basket('dia', 'd1', 1000);
    const { calls, session, call } = harness({ order: 'dia', cache });
    const result = await addCardToCart({
      session,
      cache,
      chain: 'coto',
      id: 'c9',
      owner: null,
      compareOn: true,
      cotoEnabled: true,
      call,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, 'switch_required');
    assert.equal(calls.length, 0);
  });

  it('calls choose_retailer before the add when the order is unset', async () => {
    const cache = emptyCache();
    cache.products.set('d1', product('d1'));
    const { calls, session, call } = harness({ cache, compareOn: true, cotoEnabled: true });
    const result = await addCardToCart({
      session,
      cache,
      chain: 'dia',
      id: 'd1',
      owner: null,
      compareOn: true,
      cotoEnabled: true,
      call,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.map((row) => row.name),
      ['choose_retailer', 'add_to_cart', 'get_cart_link'],
    );
    assert.deepEqual(calls[0]?.input, { retailer: 'dia' });
  });

  it('enforces the Coto freeze before any write', async () => {
    const cache = emptyCache();
    cache.coto = { c9: { id: 'c9', name: 'Picada', shelfCentavos: 1000, available: true } };
    cache.cotoRealDia = { pairs: [], buyer: 'GABC' };
    const { calls, session, call } = harness({ order: 'coto', cache });
    const result = await addCardToCart({
      session,
      cache,
      chain: 'coto',
      id: 'c9',
      owner: 'OTHER',
      compareOn: true,
      cotoEnabled: true,
      call,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, 'freeze_denied');
    assert.equal(calls.length, 0);
  });
});
