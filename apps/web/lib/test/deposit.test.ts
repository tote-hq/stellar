import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { POST } from '../../app/api/deposit/route.ts';
import { depositorOf } from '../card.ts';
import { DEPLOYMENTS } from '../deployments.ts';
import {
  canDeposit,
  depositAddress,
  depositAsset,
  depositAssetFor,
  isMemo,
  mintMemo,
} from '../deposit.ts';
import { networkAccess } from '../network-access.ts';
import { walletProofMessage, type WalletProof } from '../wallet-proof.ts';

const G = 'GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK';
const C = 'CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557';

describe('deposit asset', () => {
  it('RULE: is the classic USDC on testnet too, so preview rehearses mainnet', () => {
    // A token with no issuer cannot show up as a classic payment, so the asset
    // falls back to lumens rather than quoting something unobservable. Blanking
    // the issuer must fail here instead of quietly reverting to that branch.
    for (const net of ['testnet', 'mainnet'] as const) {
      const asset = depositAsset(net);
      const issuerless = asset.issuer === null;
      assert.equal(issuerless, !DEPLOYMENTS[net].usdcIssuer, `${net}`);
      if (issuerless) assert.equal(asset.code, 'XLM');
    }

    const testnet = depositAsset('testnet');
    assert.notEqual(testnet.issuer, null, 'testnet must not fall back to the XLM branch');
    assert.deepEqual(testnet, {
      code: 'USDC',
      issuer: 'GCGV3225QTJFJ32KTPJNOR5SYANP4QWNUGKKGKVK7ILMK4QACZHJTGJB',
    });

    const mainnet = depositAsset('mainnet');
    assert.notEqual(mainnet.issuer, null, 'mainnet must never fall to the XLM branch');
    assert.deepEqual(mainnet, {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    });
    // Play money and real money must never be one asset.
    assert.notEqual(testnet.issuer, mainnet.issuer);

    const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    assert.deepEqual(depositAssetFor('USDC', issuer), { code: 'USDC', issuer });
    assert.deepEqual(depositAssetFor('USDC', ''), { code: 'XLM', issuer: null });
    assert.deepEqual(depositAssetFor('USDC', null), { code: 'XLM', issuer: null });
  });
});

describe('deposit address', () => {
  it('reads the network it was asked about', () => {
    const env = { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: G, DEPOSIT_ADDRESS_MAINNET: '' } as NodeJS.ProcessEnv;
    assert.equal(depositAddress('testnet', env), G);
    assert.equal(depositAddress('mainnet', env), null);
    // A shopper is told to send money here. A typo that survives this check
    // is money sent into nothing, and nobody finds out until they ask.
    for (const bad of ['', '   ', 'not-an-address', C, G.slice(0, -1)]) {
      assert.equal(depositAddress('testnet', { NODE_ENV: 'test', DEPOSIT_ADDRESS_TESTNET: bad } as NodeJS.ProcessEnv), null, bad);
    }
    assert.equal(canDeposit('mainnet', { NODE_ENV: 'test', DEPOSIT_ADDRESS_MAINNET: G } as NodeJS.ProcessEnv), true);
    assert.equal(canDeposit('mainnet', { NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
  });
});

describe('the deposit opens modo real without a deploy', () => {
  it('RULE: the allowlist is still the wall, address or not', () => {
    // Mainnet has no escrow; the mode switch still has to be reachable once
    // there is an address to pay into. Opening the deposit must not have
    // opened the gate.
    const open = {
      NODE_ENV: 'production',
      REAL_MODE_OPEN_TO_ALL: '1',
      DEPOSIT_ADDRESS_MAINNET: G,
    } as NodeJS.ProcessEnv;
    assert.deepEqual(networkAccess(G, 'mainnet', open), {
      mode: 'public',
      allowed: true,
      configured: true,
      usable: true,
    });
    const bare = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(G, 'mainnet', bare).usable, false);
    const walled = {
      NODE_ENV: 'production',
      REAL_MODE_ALLOWLIST_ADDRESSES: C,
      DEPOSIT_ADDRESS_MAINNET: G,
    } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(G, 'mainnet', walled).allowed, false);
    assert.equal(networkAccess(G, 'mainnet', walled).usable, false);
  });
});

describe('the memo', () => {
  it('RULE: has no character that reads as another', () => {
    // It gets retyped off a screen. 0/O, 1/I/l are the pairs that cost an
    // afternoon, so the alphabet has none of them. A generator that returns
    // the same memo twice puts two orders on one payment.
    let all = '';
    for (let i = 0; i < 500; i += 1) all += mintMemo();
    assert.doesNotMatch(all, /[01OIL]/);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(mintMemo());
    assert.ok(seen.size > 1990, `only ${seen.size} distinct`);
  });
});

/* ------------------------------------------------------------------ *
 * The route itself, which is where the flags actually land.
 *
 * `lib/test/deposit-gate.test.ts` proves the decision; this proves the
 * handler asks for it, asks *before* it looks anything up, and writes down
 * who asked. The route reads `process.env` at request time — it has no env
 * parameter and should not grow one for a test — so these set and restore it.
 * ------------------------------------------------------------------ */

const OPERATOR = 'GDYSKGLYEO2WJSI6TWJNKEMAPLM6J5WCXH5HYRLLPIUNGOI77W22PNGB';

/** Every variable these tests touch, so a case never inherits another's. */
const TOUCHED = [
  'REAL_MODE_OPEN_TO_ALL',
  'REAL_MODE_ALLOWLIST_ADDRESSES',
  'DEPOSIT_ADDRESS_MAINNET',
  'DEPOSIT_ADDRESS_TESTNET',
  'FX_ARS_PER_USD',
] as const;

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = new Map(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
  // Pinned, so no test in this file reaches a currency API.
  process.env.FX_ARS_PER_USD = '1450';
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

function signedDeposit(kp: Keypair): WalletProof {
  const message = walletProofMessage('deposit', kp.publicKey(), Date.now());
  return { message, signature: sep53(kp, message) };
}

const ask = (body: unknown) =>
  POST(new Request('https://changuito.test/api/deposit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('POST /api/deposit under the modo real flags', () => {
  const tester = Keypair.random();
  const stranger = Keypair.random();
  const listed = { REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey(), DEPOSIT_ADDRESS_MAINNET: OPERATOR };

  it('mints for a wallet on the list that signed', async () => {
    await withEnv(listed, async () => {
      const res = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: tester.publicKey(),
        proof: signedDeposit(tester),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.network, 'mainnet');
      assert.equal(body.address, OPERATOR);
      assert.ok(isMemo(body.memo));

      const unsigned = await ask({ centavos: 500_000, network: 'mainnet', address: tester.publicKey() });
      assert.equal(unsigned.status, 401);
      assert.equal((await unsigned.json()).error, 'real_mode_session_required');

      const outsider = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: stranger.publicKey(),
        proof: signedDeposit(stranger),
      });
      assert.equal(outsider.status, 403);
      assert.equal((await outsider.json()).error, 'network_not_allowed');
    });
  });

  it('RULE: REAL_MODE_OPEN_TO_ALL lets that same stranger in, still signed', async () => {
    // The pair of cases the flag exists for, one env apart.
    await withEnv({ REAL_MODE_OPEN_TO_ALL: '1', DEPOSIT_ADDRESS_MAINNET: OPERATOR }, async () => {
      const ok = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: stranger.publicKey(),
        proof: signedDeposit(stranger),
      });
      assert.equal(ok.status, 200);

      const unsigned = await ask({ centavos: 500_000, network: 'mainnet', address: stranger.publicKey() });
      assert.equal(unsigned.status, 401);
      assert.equal((await unsigned.json()).error, 'real_mode_session_required');
    });
  });

  it('RULE: refuses a stranger before revealing whether mainnet is set up', async () => {
    // No DEPOSIT_ADDRESS_MAINNET here. A stranger must get the same 403 they
    // would get after it is set, or the refusal is a deployment announcement.
    // Once past the gate, "not set up" is the honest answer.
    await withEnv({ REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() }, async () => {
      const res = await ask({ centavos: 500_000, network: 'mainnet', address: stranger.publicKey() });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'network_not_allowed');
      const allowed = await ask({
        centavos: 500_000,
        network: 'mainnet',
        address: tester.publicKey(),
        proof: signedDeposit(tester),
      });
      assert.equal(allowed.status, 503);
    });
  });

  it('leaves modo prueba open to a guest with no wallet at all', async () => {
    await withEnv({ DEPOSIT_ADDRESS_TESTNET: OPERATOR }, async () => {
      const res = await ask({ centavos: 500_000, network: 'testnet' });
      assert.equal(res.status, 200);
    });
  });
});

describe('who the memo was issued to', () => {
  const tester = Keypair.random();

  it('is written down in a gated mode, so the card route can re-check it', async () => {
    await withEnv(
      { REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey(), DEPOSIT_ADDRESS_MAINNET: OPERATOR },
      async () => {
        const res = await ask({
          centavos: 500_000,
          network: 'mainnet',
          address: tester.publicKey(),
          proof: signedDeposit(tester),
        });
        const { memo } = await res.json();
        assert.equal(await depositorOf('mainnet', memo), tester.publicKey());
      },
    );
    // Mode 'open' asks for no signature, so an address in the body is a claim
    // and nothing else. Recording it would be writing down a guess.
    await withEnv({ DEPOSIT_ADDRESS_MAINNET: OPERATOR }, async () => {
      const res = await ask({ centavos: 500_000, network: 'mainnet', address: tester.publicKey() });
      assert.equal(res.status, 200);
      const { memo } = await res.json();
      assert.equal(await depositorOf('mainnet', memo), undefined);
    });
  });
});
