import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

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

mock.module('@changuito/mcp/compare', {
  namedExports: {
    async compareDiaToCoto() {
      return compareImpl();
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
