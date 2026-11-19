import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIRequestContext } from 'playwright';

import { payableTotal, toCart, type VtexOrderForm } from '../adapters/orderform.js';
import { buildCart, fetchOrderForm, setQuantity } from '../checkout/cart.js';
import { loadConfig } from '../config.js';

const cfg = loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/s' });
const OF_ID = '9f2c1b0e4d5a4f7c8e1b2a3c4d5e6f70';

interface Recorded { method: string; url: string; data?: unknown }

/** A stand-in for Playwright's APIRequestContext: records calls, replays answers. */
function fakeReq(handlers: {
  get?: (url: string) => { status?: number; body?: unknown };
  post?: (url: string, data: unknown) => { status?: number; body?: unknown; text?: string };
}) {
  const calls: Recorded[] = [];
  const reply = (r: { status?: number; body?: unknown; text?: string }) => {
    const status = r.status ?? 200;
    const text = r.text ?? JSON.stringify(r.body ?? {});
    return {
      ok: () => status >= 200 && status < 300,
      status: () => status,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  };
  const req = {
    get: async (url: string) => {
      calls.push({ method: 'GET', url });
      return reply(handlers.get?.(url) ?? { status: 404 });
    },
    post: async (url: string, opts: { data: unknown }) => {
      calls.push({ method: 'POST', url, data: opts.data });
      return reply(handlers.post?.(url, opts.data) ?? { status: 404 });
    },
  } as unknown as APIRequestContext;
  return { req, calls };
}

const emptyOrderForm: VtexOrderForm = {
  orderFormId: OF_ID,
  items: [],
  totalizers: [],
  value: 0,
  clientProfileData: { email: 'me@example.com', firstName: 'Ana', document: '30123456' },
};

function withItems(items: Array<Partial<VtexOrderForm['items']> extends never ? never : NonNullable<VtexOrderForm['items']>[number]>): VtexOrderForm {
  const itemsTotal = items.reduce((s, i) => s + (i.sellingPrice ?? 0) * i.quantity, 0);
  return {
    ...emptyOrderForm,
    items,
    totalizers: [
      { id: 'Items', name: 'Total dos Itens', value: itemsTotal },
      { id: 'Shipping', name: 'Total do Frete', value: 150_000 },
    ],
    value: itemsTotal + 150_000,
  };
}

const LECHE = { id: '272382', name: 'Leche Descremada 1L', quantity: 2, seller: 'ardiaprod1080', sellingPrice: 234_000, availability: 'available' };
const PAN = { id: '119900', name: 'Pan Lactal', quantity: 1, seller: 'ardiaprod1080', sellingPrice: 180_000, availability: 'available' };

describe('orderForm mapping', () => {
  it('reads prices as centavos and multiplies out the line', () => {
    const cart = toCart(withItems([LECHE]), 'dia', OF_ID);
    assert.equal(cart.lines[0].unitPrice.centavos, 234_000);
    assert.equal(cart.lines[0].lineTotal.centavos, 468_000);
    assert.equal(cart.lines[0].lineTotal.display, '$ 4.680,00');
  });

  // Regression. A Día cart with a promotion prices Items as the LIST total,
  // and Discounts brings it back down. A cart whose total does not match its
  // own lines is one the escrow would lock the wrong amount of USDC against.
  it('RULE: the total matches the lines when a promotion is applied', () => {
    const of = {
      ...emptyOrderForm,
      items: [
        { id: '32932', name: 'Café', quantity: 1, seller: 'ardiaprod1080', listPrice: 507_000, sellingPrice: 329_550, availability: 'available' },
        { id: '30111', name: 'Leche', quantity: 1, seller: 'ardiaprod1080', listPrice: 186_500, sellingPrice: 186_500, availability: 'available' },
        { id: '245474', name: 'Pan', quantity: 1, seller: 'ardiaprod1080', listPrice: 361_500, sellingPrice: 235_000, availability: 'available' },
        { id: '10303', name: 'Mermelada', quantity: 1, seller: 'ardiaprod1080', listPrice: 334_500, sellingPrice: 217_425, availability: 'available' },
      ],
      totalizers: [
        { id: 'Items', name: 'Total de los items', value: 1_263_000 },
        { id: 'Discounts', name: 'Total de descuentos', value: -294_525 },
      ],
      value: 968_475,
    };
    const cart = toCart(of, 'dia');
    const sumOfLines = cart.lines.reduce((s, l) => s + l.lineTotal.centavos, 0);
    assert.equal(sumOfLines, 968_475);
    assert.equal(cart.total.centavos, 968_475, 'the total must not be the pre-discount Items subtotal');
    assert.equal(cart.total.centavos, sumOfLines, 'the total must equal the lines the user was shown');
  });

  it('but payableTotal includes shipping — that is what gets charged', () => {
    assert.equal(payableTotal(withItems([LECHE, PAN])), 798_000);
    const of = { ...withItems([LECHE]), value: undefined };
    assert.equal(payableTotal(of), 468_000 + 150_000);
  });

  it('marks an unavailable line so it cannot be mistaken for a purchase', () => {
    const cart = toCart(withItems([{ ...LECHE, availability: 'withoutStock' }]), 'dia');
    assert.equal(cart.lines[0].available, false);
  });
});

describe('fetchOrderForm', () => {
  it('blames the session, not the store, when no cart comes back', async () => {
    const { req } = fakeReq({ get: () => ({ status: 401 }) });
    await assert.rejects(fetchOrderForm(req, cfg), /session_status/);
  });
});

describe('buildCart', () => {
  function scenario(after: VtexOrderForm, before: VtexOrderForm = emptyOrderForm) {
    return fakeReq({
      get: () => ({ body: before }),
      post: (url) => (url.includes('/items') ? { body: after } : { status: 404 }),
    });
  }

  it('reports a SKU the store silently dropped', async () => {
    const { req } = scenario(withItems([LECHE]));
    const r = await buildCart(req, cfg, [
      { skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' },
      { skuId: '999999', quantity: 1, sellerId: 'ardiaprod1080' },
    ]);
    assert.deepEqual(r.rejected.map((x) => x.skuId), ['999999']);
    assert.match(r.rejected[0].reason, /out of stock/);
  });

  it('reports a partial quantity rather than pretending it got what it asked for', async () => {
    const { req } = scenario(withItems([{ ...LECHE, quantity: 1 }]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 5, sellerId: 'ardiaprod1080' }]);
    assert.match(r.rejected[0].reason, /asked for 5, the store allowed 1/);
  });

  it('reports an item added but flagged unavailable', async () => {
    const { req } = scenario(withItems([{ ...LECHE, availability: 'withoutStock' }]));
    const r = await buildCart(req, cfg, [{ skuId: '272382', quantity: 2, sellerId: 'ardiaprod1080' }]);
    assert.match(r.rejected[0].reason, /marked unavailable/);
  });

  it('explains an HTTP failure and points at the likely cause', async () => {
    const { req } = fakeReq({
      get: () => ({ body: emptyOrderForm }),
      post: () => ({ status: 403, text: '{"message":"Cart does not belong to user"}' }),
    });
    await assert.rejects(
      buildCart(req, cfg, [{ skuId: '1', quantity: 1, sellerId: 's' }]),
      /HTTP 403[\s\S]*session has gone stale/,
    );
  });

  it('refuses a fractional or zero quantity before any request', async () => {
    const { req, calls } = scenario(withItems([LECHE]));
    await assert.rejects(buildCart(req, cfg, [{ skuId: '1', quantity: 0, sellerId: 's' }]), /positive whole number/);
    await assert.rejects(buildCart(req, cfg, [{ skuId: '1', quantity: 1.5, sellerId: 's' }]), /positive whole number/);
    assert.equal(calls.length, 0);
  });

  it('refuses an empty request', async () => {
    const { req } = scenario(emptyOrderForm);
    await assert.rejects(buildCart(req, cfg, []), /No items/);
  });
});

describe('setQuantity', () => {
  it('surfaces a failure instead of returning a stale cart', async () => {
    const { req } = fakeReq({ post: () => ({ status: 500 }) });
    await assert.rejects(setQuantity(req, cfg, OF_ID, 0, 3), /Could not update line 0/);
  });
});
