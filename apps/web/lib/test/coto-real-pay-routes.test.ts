import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { checkoutStore, type CheckoutRecord } from '../checkout/store.ts';

/**
 * POST /api/checkout/channels and PUT /api/checkout/open for a stored
 * coto_real_v1 record. Admission is the only gate that lets that record
 * through. A Coto record that is neither real nor a demo mock stays refused.
 * prepareOpen is mocked so the test never leaves the process.
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.CHG_SESSION_SECRET = 'session-test-secret';
delete env.DATABASE_URL;

const REFUSAL = 'Ese súper no se puede pagar desde acá.';
const SIGN_IN = 'Iniciá sesión para pagar.';
const BUYER = Keypair.random().publicKey();
const REAL = '11'.repeat(32);
const LIVE = '22'.repeat(32);
const DIA = '33'.repeat(32);
const TX = 'ab'.repeat(32);
const BASKET = 'cd'.repeat(32);

const calls = { prepare: 0 };

mock.module(new URL('../server/channels.ts', import.meta.url).href, {
  namedExports: {
    channelsKey: () => 'test-key',
    async channelsClient() {
      return null;
    },
    stellarSimulator: () => ({}),
    async noteLanded() {},
    async prepareOpen() {
      calls.prepare += 1;
      return { kind: 'sign', entries: ['entry'], validUntilLedger: 1 };
    },
    async submitOpen() {
      return { hash: TX };
    },
  },
});

function record(over: Partial<CheckoutRecord> & { orderId: string }): CheckoutRecord {
  return {
    buyer: BUYER,
    amount: '10000000',
    amountCents: 1000,
    basketHash: BASKET,
    arsPerUsd: 1000,
    totalDisplay: '10.00',
    retailer: 'coto',
    lines: [],
    handoffUrl: null,
    createdAt: 1,
    mode: 'live',
    ...over,
  };
}

function channelBody(orderId: string) {
  return {
    orderId,
    amount: '10000000',
    basketHash: BASKET,
    timeoutSecs: 3600,
    contractId: 'C'.repeat(56),
    method: 'open',
    network: 'testnet',
    step: 'prepare',
  };
}

describe('coto real channels and open', () => {
  let channelsPost: (req: Request) => Promise<Response>;
  let openPut: (req: Request) => Promise<Response>;
  let cookie: string;
  const previousEnabled = env.COTO_REAL_ENABLED;

  before(async () => {
    const { mintUserToken, USER_COOKIE } = await import('../login-gate.ts');
    cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(BUYER, 'session-test-secret'))}`;
    ({ POST: channelsPost } = await import('../../app/api/checkout/channels/route.ts'));
    ({ PUT: openPut } = await import('../../app/api/checkout/open/route.ts'));
  });

  beforeEach(async () => {
    calls.prepare = 0;
    env.COTO_REAL_ENABLED = '1';
    const { __setCotoAdmitForTests } = await import('../checkout/coto-admit.ts');
    __setCotoAdmitForTests({ flags: async () => true });
  });

  after(async () => {
    const { __setCotoAdmitForTests } = await import('../checkout/coto-admit.ts');
    __setCotoAdmitForTests({ flags: null });
    if (previousEnabled === undefined) delete env.COTO_REAL_ENABLED;
    else env.COTO_REAL_ENABLED = previousEnabled;
  });

  async function admit(admitted: boolean) {
    const { __setCotoAdmitForTests } = await import('../checkout/coto-admit.ts');
    __setCotoAdmitForTests({ flags: async () => admitted });
  }

  function postChannels(orderId: string, withCookie = true) {
    return channelsPost(
      new Request('https://app.changuito.me/api/checkout/channels', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(withCookie ? { cookie } : {}),
        },
        body: JSON.stringify(channelBody(orderId)),
      }),
    );
  }

  function putOpen(orderId: string, tx: string, withCookie = true) {
    return openPut(
      new Request('https://app.changuito.me/api/checkout/open', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(withCookie ? { cookie } : {}),
        },
        body: JSON.stringify({ orderId, tx }),
      }),
    );
  }

  it('channels prepare lets an admitted real record through and calls prepareOpen once', async () => {
    await checkoutStore().set(record({ orderId: REAL, checkoutKind: 'coto_real_v1' }));
    const res = await postChannels(REAL);
    const text = await res.text();
    assert.notEqual(res.status, 400);
    assert.equal(text.includes(REFUSAL), false);
    assert.equal(calls.prepare, 1);
  });

  it('channels refuses the same real record when the wallet is not admitted', async () => {
    await checkoutStore().set(record({ orderId: REAL, checkoutKind: 'coto_real_v1' }));
    await admit(false);
    const res = await postChannels(REAL);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, REFUSAL);
    assert.equal(calls.prepare, 0);
  });

  it('channels refuses an admitted live Coto record that is not coto_real_v1', async () => {
    await checkoutStore().set(record({ orderId: LIVE, retailer: 'coto', mode: 'live' }));
    const res = await postChannels(LIVE);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, REFUSAL);
    assert.equal(calls.prepare, 0);
  });

  it('channels without a cookie is 401', async () => {
    const res = await postChannels(REAL, false);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, SIGN_IN);
    assert.equal(calls.prepare, 0);
  });

  it('open stores the signature for an admitted real record', async () => {
    await checkoutStore().set(record({ orderId: REAL, checkoutKind: 'coto_real_v1' }));
    const res = await putOpen(REAL, TX);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).openSig, TX);
  });

  it('open refuses a real record that is not admitted and leaves openSig unset', async () => {
    await checkoutStore().set(record({ orderId: REAL, checkoutKind: 'coto_real_v1' }));
    await admit(false);
    const res = await putOpen(REAL, TX);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, REFUSAL);
    assert.equal((await checkoutStore().get(REAL))?.openSig, undefined);
  });

  it('open refuses an admitted live Coto record that is not coto_real_v1', async () => {
    await checkoutStore().set(record({ orderId: LIVE, retailer: 'coto', mode: 'live' }));
    const res = await putOpen(LIVE, TX);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, REFUSAL);
    assert.equal((await checkoutStore().get(LIVE))?.openSig, undefined);
  });

  it('open without a cookie is 401', async () => {
    const res = await putOpen(REAL, TX, false);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, SIGN_IN);
  });

  it('channels prepare still reaches prepareOpen for a Día record', async () => {
    await checkoutStore().set(record({ orderId: DIA, retailer: 'dia' }));
    const res = await postChannels(DIA);
    const text = await res.text();
    assert.notEqual(res.status, 400);
    assert.equal(text.includes(REFUSAL), false);
    assert.equal(calls.prepare, 1);
  });
});
