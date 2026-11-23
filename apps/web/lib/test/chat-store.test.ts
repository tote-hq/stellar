import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { Cart, Product } from '@changuito/mcp/types';

import type { Block } from '../chat-state.ts';
import {
  clearAllChats,
  deleteChat,
  isResumable,
  KEYS,
  listChats,
  loadChat,
  RESUMABLE_MS,
  saveChat,
  type Receipt,
} from '../chat-store.ts';

/**
 * A localStorage that behaves like the real one where it matters: string
 * values only, and a mode that throws on every call, which is what Safari in
 * private mode does and what NetworkProvider.tsx's try/catch exists for.
 */
class FakeStorage {
  map = new Map<string, string>();
  throwOnSet = false;
  throwOnEverything = false;

  getItem(k: string): string | null {
    if (this.throwOnEverything) throw new Error('SecurityError');
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnEverything || this.throwOnSet) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    if (this.throwOnEverything) throw new Error('SecurityError');
    this.map.delete(k);
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
});

const money = (centavos: number, display: string) => ({ centavos, display });

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    retailer: 'dia',
    cartId: 'cart-1',
    lines: [
      {
        index: 0,
        skuId: 'sku-1',
        name: 'Leche entera 1L',
        quantity: 2,
        sellerId: '1',
        unitPrice: money(150000, '$1.500,00'),
        lineTotal: money(300000, '$3.000,00'),
        available: true,
      },
    ],
    total: money(300000, '$3.000,00'),
    messages: ['Precio actualizado'],
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    skuId: 'sku-1',
    productId: 'p-1',
    name: 'Leche entera 1L',
    sellerId: '1',
    price: money(150000, '$1.500,00'),
    available: true,
    ...overrides,
  };
}

const blocks = (): Block[] => [
  { kind: 'user', id: 'b1', text: 'Armá un desayuno para dos' },
  { kind: 'say', id: 'b2', text: 'Listo, esto encontré.', thinking: 'razonando largo', tools: [{ id: 't1', name: 'search_products', ms: 900, ok: true }] },
  { kind: 'products', id: 'b3', items: [product()], note: 'los más baratos' },
  { kind: 'cart', id: 'b4', cart: cart(), handoffUrl: 'https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=cart-1#/cart' },
];

const save = (over: Partial<Parameters<typeof saveChat>[0]> = {}) =>
  saveChat({
    id: 'c1',
    createdAt: 1_000,
    sessionId: 's-1',
    state: { blocks: blocks(), cart: { cart: cart(), handoffUrl: 'https://x.test/h' } },
    orderState: 'open',
    now: 2_000,
    ...over,
  });

/** Every string written, so a test can look for something that should not be there. */
function everythingWritten(): string {
  return [...storage.map.values()].join('\n');
}

describe('chat store: round trip', () => {
  it('brings back the transcript it was given', () => {
    const summary = save();
    assert.ok(summary);
    const back = loadChat('c1');
    assert.ok(back);
    assert.equal(back.id, 'c1');
    assert.equal(back.sessionId, 's-1');
    assert.equal(back.orderState, 'open');
    assert.deepEqual(back.blocks.map((b) => b.kind), ['user', 'say', 'products', 'cart']);
    const restored = back.blocks[3];
    assert.equal(restored?.kind, 'cart');
    if (restored?.kind === 'cart') {
      assert.equal(restored.cart.lines[0]?.name, 'Leche entera 1L');
      assert.equal(restored.cart.total.display, '$3.000,00');
      assert.match(restored.handoffUrl ?? '', /orderFormId=cart-1/);
    }
    assert.doesNotMatch(everythingWritten(), /razonando largo/);
    const say = back.blocks[1];
    assert.equal(say?.kind === 'say' ? say.thinking : 'missing', '');
  });

  it('round-trips a compare block and drops a price of zero', () => {
    const compare: Block = {
      kind: 'compare',
      id: 'b9',
      status: 'ok',
      cartId: 'cart-1',
      handoffUrl: 'https://dia.example/cart',
      matched: 1,
      lines: 2,
      gap: { diaSubtotalCentavos: 10_000, cotoSubtotalCentavos: 8_000, gapCentavos: 2_000 },
      rows: [
        {
          skuId: 'sku-1',
          name: 'Leche',
          quantity: 1,
          diaLineCentavos: 10_000,
          confidence: 'ean',
          coto: {
            id: 'coto-1',
            name: 'Leche Coto',
            shelfCentavos: 8_000,
            lineCentavos: 8_000,
            available: true,
            url: 'https://www.coto.com.ar/product/leche',
          },
        },
        {
          skuId: 'sku-2',
          name: 'Yerba',
          quantity: 1,
          diaLineCentavos: 5_000,
          confidence: 'failed',
          coto: {
            id: 'zero',
            name: 'Nada',
            shelfCentavos: 0,
            lineCentavos: 0,
            available: true,
          },
        },
      ],
    };
    Object.assign(compare, { password: 'hunter2' });
    save({ state: { blocks: [compare] } });
    const back = loadChat('c1');
    const restored = back?.blocks[0];
    assert.equal(restored?.kind, 'compare');
    if (restored?.kind === 'compare') {
      assert.equal(restored.status, 'ok');
      assert.equal(restored.gap?.gapCentavos, 2_000);
      assert.equal(restored.rows[0]?.coto?.url, 'https://www.coto.com.ar/product/leche');
      assert.equal(restored.rows[1]?.coto, undefined);
      assert.equal(restored.handoffUrl, 'https://dia.example/cart');
    }
    assert.doesNotMatch(everythingWritten(), /hunter2/);
    assert.doesNotMatch(everythingWritten(), /"lineCentavos":0/);
  });

  it('writes nothing for a chat with no blocks', () => {
    // The app mints an id on load. An empty chat in the rail is a dead row.
    assert.equal(save({ state: { blocks: [] } }), null);
    assert.deepEqual(listChats(), []);
  });
});

describe('chat store: RULE: credentials are never written', () => {
  it('drops fields the serializer does not name, even when they are on the object', () => {
    // The guardrail is the allow-list, so the test is: hand it a block that
    // carries a secret in a field the packer does not mention, and read back
    // what actually reached storage.
    const poisoned = blocks();
    Object.assign(poisoned[0] as object, { password: 'hunter2' });
    Object.assign((poisoned[3] as { cart: Cart }).cart, { pan: '4111111111111111', cvv: '737' });
    Object.assign((poisoned[3] as { cart: Cart }).cart.lines[0] as object, { cvc: '999' });
    save({ state: { blocks: poisoned } });

    const written = everythingWritten();
    for (const secret of ['hunter2', '4111111111111111', '737', '999']) {
      assert.doesNotMatch(written, new RegExp(secret), `leaked ${secret}`);
    }
    for (const key of ['password', '"pan"', 'cvv', 'cvc', 'secret', 'token']) {
      assert.doesNotMatch(written, new RegExp(key, 'i'), `wrote a ${key} field`);
    }
  });

});

describe('chat store: what comes back is not trusted', () => {
  it('survives garbage in the index', () => {
    storage.map.set(KEYS.index, 'not json at all');
    assert.deepEqual(listChats(), []);
    storage.map.set(KEYS.index, JSON.stringify({ not: 'an array' }));
    assert.deepEqual(listChats(), []);
    storage.map.set(KEYS.index, JSON.stringify([null, 3, 'x', { id: 'ok', createdAt: 5 }]));
    assert.deepEqual(listChats().map((c) => c.id), ['ok']);

    storage.map.set(`${KEYS.prefix}c1`, '{{{');
    assert.equal(loadChat('c1'), null);
    storage.map.set(`${KEYS.prefix}c1`, JSON.stringify({ v: 1, id: 'c1', createdAt: 1, blocks: 'nope' }));
    assert.deepEqual(loadChat('c1')?.blocks, []);

    save();
    const versioned = JSON.parse(storage.map.get(`${KEYS.prefix}c1`) as string) as Record<string, unknown>;
    versioned.v = 99;
    storage.map.set(`${KEYS.prefix}c1`, JSON.stringify(versioned));
    assert.equal(loadChat('c1'), null);

    save();
    const owned = storage.map.get(`${KEYS.prefix}c1`) as string;
    storage.map.set(`${KEYS.prefix}c2`, owned);
    assert.equal(loadChat('c2'), null);

    storage.map.set(
      `${KEYS.prefix}c1`,
      JSON.stringify({
        v: 1, id: 'c1', createdAt: 1, blocks: [
          { kind: 'user', id: 'b1', text: 'ok' },
          { kind: 'user', id: 'b2' },                       // no text
          { kind: 'cart', id: 'b3', cart: { retailer: 'dia' } }, // no total
          { kind: 'invented', id: 'b4' },
          { kind: 'products', id: 'b5', items: [{ skuId: 'x' }] }, // nothing valid inside
        ],
      }),
    );
    assert.deepEqual(loadChat('c1')?.blocks.map((b) => b.id), ['b1']);

    save({ orderState: 'paid' });
    const raw = JSON.parse(storage.map.get(`${KEYS.prefix}c1`) as string) as Record<string, unknown>;
    raw.orderState = 'definitely-paid-trust-me';
    storage.map.set(`${KEYS.prefix}c1`, JSON.stringify(raw));
    assert.equal(loadChat('c1')?.orderState, 'none');
  });
});

describe('chat store: a browser that refuses', () => {
  it('reports a quota failure rather than claiming it saved', () => {
    storage.throwOnSet = true;
    assert.equal(save(), null);
    storage.throwOnSet = false;
    storage.throwOnEverything = true;
    assert.doesNotThrow(() => {
      assert.equal(save(), null);
      assert.deepEqual(listChats(), []);
      assert.equal(loadChat('c1'), null);
      deleteChat('c1');
      clearAllChats();
    });
  });
});

describe('chat store: RULE: a chat stops being resumable', () => {
  it('never resumes a paid chat, however fresh', () => {
    const base = { orderState: 'open' as const, updatedAt: 1_000, sessionId: 's-1' };
    // Past the Redis TTL the id is live and the server has forgotten it.
    assert.equal(isResumable(base, 1_000 + RESUMABLE_MS - 1), true);
    assert.equal(isResumable(base, 1_000 + RESUMABLE_MS), false);
    assert.equal(isResumable(base, 1_000 + RESUMABLE_MS + 60_000), false);
    // One chat is one order. This is that rule from the other direction.
    assert.equal(isResumable({ ...base, orderState: 'paid' }, 1_000), false);
    assert.equal(isResumable({ ...base, sessionId: null }, 1_000), false);
  });
});

describe('chat store: the session snapshot', () => {
  const snapshot = {
    carts: { dia: 'cart-1' },
    location: {
      retailer: 'dia',
      country: 'ARG',
      postalCode: '1425',
      salesChannel: '1',
      degraded: false,
      sellers: [{ id: '1', name: 'Día' }],
      regionId: 'v2.ABC',
    },
  };

  it('comes back whole, because the agent acts on it', () => {
    // Unlike the blocks, this is not a record for the shopper to read — it
    // goes back to the server on the next turn. A snapshot missing sellers or
    // salesChannel would quietly move the agent to national prices.
    save({ state: { blocks: blocks(), snapshot } });
    assert.deepEqual(loadChat('c1')?.snapshot, snapshot);

    const raw = JSON.parse(storage.map.get(`${KEYS.prefix}c1`) as string) as Record<string, unknown>;
    delete ((raw.snapshot as Record<string, unknown>).location as Record<string, unknown>).salesChannel;
    storage.map.set(`${KEYS.prefix}c1`, JSON.stringify(raw));
    const back = loadChat('c1');
    assert.equal(back?.snapshot?.location, undefined);
    // The cart ids survive: they are independently useful and independently valid.
    assert.deepEqual(back?.snapshot?.carts, { dia: 'cart-1' });
  });
});

describe('chat store: receipts', () => {
  const receipt: Receipt = {
    orderId: '1234567890-01',
    retailer: 'dia',
    paidDisplay: '24,50 USDC',
    paidAt: 5_000,
    lines: [{ name: 'Leche entera 1L', quantity: 2, lineTotal: '$3.000,00' }],
    total: '$3.000,00',
  };

  it('keeps a paid order readable after the chat is closed', () => {
    save({ orderState: 'paid', receipt });
    const back = loadChat('c1');
    assert.equal(back?.orderState, 'paid');
    assert.deepEqual(back?.receipt, receipt);
    assert.equal(isResumable(back!, 5_001), false);

    save();
    assert.equal(loadChat('c1')?.receipt, null);

    save({ orderState: 'paid', receipt });
    const raw = JSON.parse(storage.map.get(`${KEYS.prefix}c1`) as string) as Record<string, unknown>;
    delete (raw.receipt as Record<string, unknown>).orderId;
    storage.map.set(`${KEYS.prefix}c1`, JSON.stringify(raw));
    assert.equal(loadChat('c1')?.receipt, null);
  });
});
