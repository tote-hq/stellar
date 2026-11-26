import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { checkoutStore } from '../checkout/store.ts';
import { __setConfigForTests } from '../config.ts';
import type { ComparisonRow } from '../checkout/compare-fee.ts';

/**
 * POST /api/checkout/quote — compare fee paths and accept-only Coto.
 * Plan §7: compare fail/timeout → fee 0 + feeBasis (not 503); coto off →
 * other_disabled; Coto quote hashes accepted lines only; missing ids → 400.
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.CHG_SESSION_SECRET = 'session-test-secret';
env.ARS_PER_USD = '1000';
delete env.DATABASE_URL;
delete env.QUOTE_BUFFER;

const BUYER = Keypair.random().publicKey();

const cart = {
  retailer: 'dia',
  cartId: 'dia-cart-1',
  lines: [
    {
      index: 0,
      skuId: 'dia-a',
      name: 'Leche',
      quantity: 1,
      sellerId: 'dia',
      unitPrice: { centavos: 1000, display: '$10,00' },
      lineTotal: { centavos: 1000, display: '$10,00' },
      available: true,
    },
    {
      index: 1,
      skuId: 'dia-b',
      name: 'Pan',
      quantity: 1,
      sellerId: 'dia',
      unitPrice: { centavos: 500, display: '$5,00' },
      lineTotal: { centavos: 500, display: '$5,00' },
      available: true,
    },
  ],
  total: { centavos: 1500, display: '$15,00' },
  messages: [],
};

const matchedRows: ComparisonRow[] = [
  {
    skuId: 'dia-a',
    name: 'Leche',
    quantity: 1,
    diaLineCentavos: 1000,
    confidence: 'ean',
    coto: {
      id: 'coto-a',
      name: 'Leche Coto',
      shelfCentavos: 800,
      lineCentavos: 800,
      available: true,
    },
  },
  {
    skuId: 'dia-b',
    name: 'Pan',
    quantity: 1,
    diaLineCentavos: 500,
    confidence: 'brand_size_unit',
    coto: {
      id: 'coto-b',
      name: 'Pan Coto',
      shelfCentavos: 400,
      lineCentavos: 400,
      available: true,
    },
  },
];

let compareImpl: () => Promise<{ rows: ComparisonRow[] }> = async () => ({ rows: matchedRows });
let priceImpl: (
  cartId: string,
  lines: { id: string; quantity: number }[],
) => Promise<unknown> = async () => {
  throw new Error('coto real reprice is not this test');
};

mock.module('@changuito/mcp/compare', {
  namedExports: {
    async compareDiaToCoto() {
      return compareImpl();
    },
    cotoPricer() {
      return { async getProduct() { return null; } };
    },
    priceCotoCart(cartId: string, lines: { id: string; quantity: number }[]) {
      return priceImpl(cartId, lines);
    },
  },
});

mock.module(new URL('../checkout/shipping.ts', import.meta.url).href, {
  namedExports: {
    NO_DELIVERY: 'NO_DELIVERY',
    async quoteShipping() {
      return { centavos: 0, sla: 'mock' };
    },
  },
});

mock.module(new URL('../profile.ts', import.meta.url).href, {
  namedExports: {
    async getProfile() {
      return { postcode: '1425' };
    },
  },
});

mock.module(new URL('../checkout/manual-server.ts', import.meta.url).href, {
  namedExports: {
    async manualMember() {
      return false;
    },
    async manualAvailable() {
      return false;
    },
    manualStatus() {
      return null;
    },
  },
});

describe('POST /api/checkout/quote compare + Coto accept', () => {
  let POST: (req: Request) => Promise<Response>;
  let cookie: string;

  before(async () => {
    const { mintUserToken, USER_COOKIE } = await import('../login-gate.ts');
    cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(BUYER, 'session-test-secret'))}`;
    ({ POST } = await import('../../app/api/checkout/quote/route.ts'));
  });

  beforeEach(() => {
    compareImpl = async () => ({ rows: matchedRows });
    __setConfigForTests({
      sandbox_mock: true,
      chat_dual_checkout_demo: true,
      retailer_search: { order: ['dia', 'coto'], enabled: { dia: true, coto: true } },
    });
  });

  after(() => {
    __setConfigForTests(null);
  });

  const ask = (body: unknown) =>
    POST(
      new Request('https://app.changuito.me/api/checkout/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
    );

  it('compare throw → 200 with fee 0 and feeBasis compare_failed (not 503)', async () => {
    compareImpl = async () => {
      throw new Error('catalog down');
    };
    const res = await ask({
      cart,
      compare: true,
      checkoutPath: 'dual',
      location: { postalCode: '1425' },
      handoffUrl: 'https://dia.test/cart',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.comparison.feeCentavos, 0);
    assert.equal(body.comparison.feeUsdCents, 0);
    assert.equal(body.comparison.feeBasis, 'compare_failed');
    assert.equal(body.checkoutPath, 'dual');
  });

  it('compare timeout message → feeBasis timeout', async () => {
    compareImpl = async () => {
      throw new Error('AbortError: timeout waiting for Coto');
    };
    const res = await ask({
      cart,
      compare: true,
      location: { postalCode: '1425' },
      handoffUrl: 'https://dia.test/cart',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.comparison.feeBasis, 'timeout');
    assert.equal(body.comparison.feeUsdCents, 0);
  });

  it('retailer_search.enabled.coto=false → other_disabled, fee 0', async () => {
    __setConfigForTests({
      sandbox_mock: true,
      chat_dual_checkout_demo: true,
      retailer_search: { order: ['dia', 'coto'], enabled: { dia: true, coto: false } },
    });
    const res = await ask({
      cart,
      compare: true,
      checkoutPath: 'solo_dia',
      location: { postalCode: '1425' },
      handoffUrl: 'https://dia.test/cart',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.comparison.feeBasis, 'other_disabled');
    assert.equal(body.comparison.feeUsdCents, 0);
    assert.equal(body.checkoutPath, 'solo_dia');
  });

  it('Coto quote with accepted ids locks only those lines and includes the gap fee', async () => {
    const res = await ask({
      cart,
      payRetailer: 'coto',
      checkoutPath: 'solo_coto',
      acceptedAlternatives: [{ diaSkuId: 'dia-a', cotoId: 'coto-a' }],
      location: { postalCode: '1425' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.checkoutPath, 'solo_coto');
    assert.equal(body.subtotalCentavos, 800);
    // Gap |1000−800|=200 → fee 40 centavos; amount locks basket + fee.
    assert.equal(body.comparison.feeCentavos, 40);
    assert.equal(body.comparison.feeBasis, 'gap');
    assert.ok(body.amountCents > 0);
    assert.equal(body.comparison.rows.length, 1);
    assert.equal(body.comparison.rows[0].coto.id, 'coto-a');
  });

  it('a non-admitted wallet sending coto_real_v1 gets 400 and no checkout record', async () => {
    delete process.env.COTO_REAL_ENABLED;
    delete process.env.COTO_REAL_ALLOWLIST;
    const cotoCart = { ...cart, retailer: 'coto', cartId: 'coto-1' };
    const before = (await checkoutStore().listByBuyer(BUYER)).length;
    const res = await ask({
      cart: cotoCart,
      checkoutKind: 'coto_real_v1',
      location: { postalCode: '1425' },
      sessionId: '00000000-0000-4000-8000-000000000001',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Ese súper no se puede pagar desde acá.');
    assert.equal(body.orderId, undefined);
    assert.equal((await checkoutStore().listByBuyer(BUYER)).length, before);
  });

  it('an admitted quote uses the catalog price, and a foreign or guest snapshot is refused', async () => {
    const { __setCotoRealTurnReaderForTests } = await import('../checkout/coto-real-http.ts');
    const { __setCotoAdmitForTests } = await import('../checkout/coto-admit.ts');
    const sessionId = '00000000-0000-4000-8000-0000000000aa';
    const previous = process.env.COTO_REAL_ENABLED;
    process.env.COTO_REAL_ENABLED = '1';
    __setCotoAdmitForTests({ flags: async () => true });
    const cotoCart = {
      ...cart,
      retailer: 'coto',
      cartId: 'coto-real-1',
      total: { centavos: 1, display: '$0,01' },
      lines: [
        {
          ...cart.lines[0],
          skuId: 'coto-real',
          quantity: 1,
          lineTotal: { centavos: 1, display: '$0,01' },
        },
      ],
    };
    const snapshot = (buyer?: string) => ({
      messages: [],
      cache: {
        products: new Map(),
        cotoRealDia: {
          ...(buyer ? { buyer } : {}),
          pairs: [{ cotoId: 'coto-real', diaSkuId: 'd1', diaCentavos: 247500, confidence: 'ean' as const }],
        },
      },
    });
    const turns = new Map<string, ReturnType<typeof snapshot>>();
    __setCotoRealTurnReaderForTests(async (id) => turns.get(id) as never);
    priceImpl = async (cartId, lines) => ({
      retailer: 'coto',
      cartId,
      messages: [],
      total: { centavos: 247400, display: '$2474,00' },
      lines: lines.map((line, index) => ({
        index,
        skuId: line.id,
        name: 'Leche',
        quantity: line.quantity,
        sellerId: 'coto',
        unitPrice: { centavos: 247400, display: '$2474,00' },
        lineTotal: { centavos: 247400 * line.quantity, display: '$2474,00' },
        available: true,
      })),
    });
    const before = (await checkoutStore().listByBuyer(BUYER)).length;
    try {
      turns.set(sessionId, snapshot('GOTHER'));
      const foreign = await ask({ cart: cotoCart, checkoutKind: 'coto_real_v1', sessionId, postalCode: '1425' });
      assert.equal(foreign.status, 400);
      assert.equal((await foreign.json()).error, 'Este changuito está asociado a otra cuenta.');

      turns.set(sessionId, snapshot());
      const guest = await ask({ cart: cotoCart, checkoutKind: 'coto_real_v1', sessionId, postalCode: '1425' });
      assert.equal(guest.status, 400);
      assert.equal((await guest.json()).error, 'Confirmá Coto de nuevo con la sesión iniciada.');

      turns.set(sessionId, snapshot(BUYER));
      const home = await ask({
        cart: cotoCart,
        checkoutKind: 'coto_real_v1',
        sessionId,
        postalCode: '1425',
        city: 'CABA',
        fulfillment: 'home',
        street: 'Calle Privada',
        number: '10',
      });
      assert.equal(home.status, 400);
      const homeBody = await home.json();
      assert.equal(homeBody.error, 'El envío a domicilio arranca en $ 30.000. Podés sumar productos o retirar en una sucursal.');
      assert.equal(JSON.stringify(homeBody).includes('Calle Privada'), false);
      assert.equal((await checkoutStore().listByBuyer(BUYER)).length, before);

      const ok = await ask({
        cart: cotoCart,
        checkoutKind: 'coto_real_v1',
        sessionId,
        postalCode: '1425',
        city: 'CABA',
        fulfillment: 'pickup',
      });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.checkoutKind, 'coto_real_v1');
      assert.equal(body.cotoTicketCentavos, 247400);
      assert.equal(body.feeCentavos, 20);
      assert.equal(body.shippingProvisionCentavos, 0);
      assert.equal(body.lockCentavos, 247420);
      assert.match(body.orderId, /^[0-9a-f]{64}$/);
      assert.match(body.basketHash, /^[0-9a-f]{64}$/);
      assert.equal(body.coverage, 'ok');
      assert.equal(JSON.stringify(body).includes('Calle'), false);
      const stored = await checkoutStore().get(body.orderId);
      assert.equal(stored?.checkoutKind, 'coto_real_v1');
      assert.equal(stored?.mode, 'live');
      assert.equal(stored?.fulfillment, 'pickup');
      assert.equal(stored?.resolvedAddress, undefined);
      assert.equal(stored?.buyer, BUYER);
      assert.ok(stored && BigInt(stored.amount) > 0n);
      assert.equal((await checkoutStore().listByBuyer(BUYER)).length, before + 1);
    } finally {
      __setCotoRealTurnReaderForTests(null);
      __setCotoAdmitForTests({ flags: null });
      priceImpl = async () => {
        throw new Error('coto real reprice is not this test');
      };
      if (previous === undefined) delete process.env.COTO_REAL_ENABLED;
      else process.env.COTO_REAL_ENABLED = previous;
    }
  });

  it('Coto quote with missing accepted ids → 400', async () => {
    const missing = await ask({
      cart,
      payRetailer: 'coto',
      location: { postalCode: '1425' },
    });
    assert.equal(missing.status, 400);

    const empty = await ask({
      cart,
      payRetailer: 'coto',
      acceptedAlternatives: [],
      location: { postalCode: '1425' },
    });
    assert.equal(empty.status, 400);

    const noMatch = await ask({
      cart,
      payRetailer: 'coto',
      acceptedAlternatives: [{ diaSkuId: 'dia-x', cotoId: 'coto-x' }],
      location: { postalCode: '1425' },
    });
    assert.equal(noMatch.status, 400);
  });
});
