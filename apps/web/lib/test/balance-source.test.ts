import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { __setConfigForTests } from '../config.ts';
import { CIRCLE_TESTNET_USDC, DEPLOYMENTS } from '../deployments.ts';
import { balanceLineView, circleBalanceCopy, trustlineCopy } from '../mode-copy.ts';
import { chain, mockBindings } from './support/fake-soroban.ts';

/**
 * The balance line can name Circle. `usdc` stays the mock token the checkout
 * spends. Bindings are mocked so the handler can load under strip-types.
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
env.CHG_SESSION_SECRET = 'session-test-secret';
delete env.DATABASE_URL;

mockBindings();

const ACCOUNT = DEPLOYMENTS.testnet.resolver;
const CONTRACT = DEPLOYMENTS.testnet.usdcId;
const MOCK_UNITS = 250n * 10n ** 7n;
const CIRCLE_UNITS = 40n * 10n ** 7n;
const ISSUER = CIRCLE_TESTNET_USDC.issuer;

const horizon = new Map<string, { asset_type: string; balance: string; asset_code?: string; asset_issuer?: string }[]>();

describe('balance route source', () => {
  let GET: (req: Request) => Promise<Response>;
  let human: string;
  let userCookie: string;
  let sacId: string;
  const realFetch = globalThis.fetch;
  let prevKey: string | undefined;
  let prevMain: string | undefined;

  before(async () => {
    prevKey = env.NEXT_PUBLIC_POLLAR_API_KEY;
    prevMain = env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET;
    delete env.NEXT_PUBLIC_POLLAR_API_KEY;
    delete env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET;

    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    const { USER_COOKIE, mintUserToken } = await import('../login-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    userCookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(ACCOUNT, 'session-test-secret'))}`;
    GET = (await import('../../app/api/balance/route.ts')).GET;
    sacId = (await import('../token.ts')).circleTestnetContractId();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/accounts/')) {
        const address = decodeURIComponent(url.split('/accounts/')[1] ?? '');
        const balances = horizon.get(address);
        if (!balances) return new Response('missing', { status: 404 });
        return Response.json({ balances });
      }
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;
  });

  beforeEach(() => {
    chain.reset();
    horizon.clear();
    chain.balances.set(ACCOUNT, MOCK_UNITS);
    chain.balances.set(CONTRACT, MOCK_UNITS);
    __setConfigForTests({});
    horizon.set(ACCOUNT, [{ asset_type: 'native', balance: '10.0000000' }]);
  });

  after(() => {
    globalThis.fetch = realFetch;
    __setConfigForTests(null);
    if (prevKey === undefined) delete env.NEXT_PUBLIC_POLLAR_API_KEY;
    else env.NEXT_PUBLIC_POLLAR_API_KEY = prevKey;
    if (prevMain === undefined) delete env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET;
    else env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET = prevMain;
  });

  const ask = (address: string, network: string, cookie = human) =>
    GET(
      new Request(`https://changuito.test/api/balance?address=${encodeURIComponent(address)}&network=${network}`, {
        headers: { cookie },
      }),
    );

  it('mock is unchanged: no line, and usdc is the token balance', async () => {
    const res = await ask(ACCOUNT, 'testnet');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usdc, MOCK_UNITS.toString());
    assert.equal(body.usdcDisplay, '250.00');
    assert.equal(body.line, undefined);
    assert.equal(chain.balanceContracts.includes(sacId), false);
  });

  it('circle adds line and leaves usdc on the mock token', async () => {
    __setConfigForTests({ usdc_source_guest: 'circle', usdc_source_signed_in: 'mock' });
    horizon.set(ACCOUNT, [
      { asset_type: 'native', balance: '10.0000000' },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: ISSUER, balance: '40.0000000' },
    ]);
    const res = await ask(ACCOUNT, 'testnet');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usdc, MOCK_UNITS.toString());
    assert.equal(body.line.source, 'circle');
    assert.equal(body.line.usdc, CIRCLE_UNITS.toString());
    assert.equal(body.line.usdcDisplay, '40.00');
    assert.equal(body.line.trustline, 'ok');
    assert.equal(chain.balanceContracts.includes(sacId), false);
  });

  it('no Circle trustline is zero plus the existing trustline hint', async () => {
    __setConfigForTests({ usdc_source_guest: 'circle' });
    const res = await ask(ACCOUNT, 'testnet');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usdc, MOCK_UNITS.toString());
    assert.equal(body.line.usdc, '0');
    assert.equal(body.line.usdcDisplay, '0.00');
    assert.equal(body.line.trustline, 'needed');
    const view = balanceLineView(body, 'USDC de prueba', 'es');
    assert.equal(view.amount, '0.00');
    assert.equal(view.unit, circleBalanceCopy('es').unit);
    assert.equal(view.hint, trustlineCopy('es').body);
    assert.equal(circleBalanceCopy('es').hint, 'Es USDC de Circle en la red de prueba. No es plata real.');
    assert.equal(circleBalanceCopy('en').unit, 'testnet USDC (Circle)');
  });

  it('the session picks the key, and a forged cookie counts as a guest', async () => {
    __setConfigForTests({ usdc_source_guest: 'mock', usdc_source_signed_in: 'circle' });
    horizon.set(ACCOUNT, [
      { asset_type: 'native', balance: '1' },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: ISSUER, balance: '40.0000000' },
    ]);
    const signed = await ask(ACCOUNT, 'testnet', `${human}; ${userCookie}`);
    assert.equal((await signed.json()).line.source, 'circle');

    __setConfigForTests({ usdc_source_guest: 'mock', usdc_source_signed_in: 'circle' });
    const forged = await ask(ACCOUNT, 'testnet', `${human}; chg_user=not-a-token`);
    assert.equal((await forged.json()).line, undefined);

    __setConfigForTests({ usdc_source_guest: 'circle', usdc_source_signed_in: 'mock' });
    const guestFlag = await ask(ACCOUNT, 'testnet', `${human}; chg_user=not-a-token`);
    assert.equal((await guestFlag.json()).line.source, 'circle');
  });

  it('a contract holder reads the derived Circle SAC, not the mock id', async () => {
    __setConfigForTests({ usdc_source_guest: 'circle' });
    chain.balances.set(`${sacId}:${CONTRACT}`, CIRCLE_UNITS);
    const res = await ask(CONTRACT, 'testnet');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usdc, MOCK_UNITS.toString());
    assert.equal(body.line.usdc, CIRCLE_UNITS.toString());
    assert.equal(body.line.trustline, 'not-needed');
    assert.equal(chain.balanceContracts.includes(sacId), true);
    assert.notEqual(sacId, DEPLOYMENTS.testnet.usdcId);
  });

  it('a failed Circle SAC read keeps the mock balance and marks the line failed', async () => {
    __setConfigForTests({ usdc_source_guest: 'circle' });
    chain.failBalances.add(sacId);
    const res = await ask(CONTRACT, 'testnet');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.usdc, MOCK_UNITS.toString());
    assert.equal(body.usdcDisplay, '250.00');
    assert.equal(body.line.source, 'circle');
    assert.equal(body.line.failed, true);
    const view = balanceLineView(body, 'USDC de prueba', 'es');
    assert.equal(view.amount, '-');
    assert.equal(view.unit, circleBalanceCopy('es').unit);
    assert.notEqual(view.unit, 'USDC de prueba');
    assert.equal(chain.balanceContracts.includes(sacId), true);
    assert.equal(chain.balanceContracts.includes(CONTRACT), true);
  });

  it('mainnet does not attach a circle line', async () => {
    __setConfigForTests({ usdc_source_guest: 'circle', usdc_source_signed_in: 'circle' });
    const buyer = Keypair.random().publicKey();
    try {
      const res = await ask(buyer, 'mainnet');
      const text = await res.text();
      assert.equal(text.includes('"line"'), false);
      assert.equal(text.includes(ISSUER), false);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      assert.equal(text.includes(ISSUER), false);
    }
  });
});
