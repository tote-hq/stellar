import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK } from '../deployments.ts';
import { FAUCET_GRANTS_PER_HOUR, gateFaucet } from '../faucet-gate.ts';
import { memoryCounter } from '../login-gate.ts';
import { walletProofMessage } from '../wallet-proof.ts';
import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';
import type { NetworkId } from '../deployments.ts';
import type { WalletDirectory, WalletStanding } from '../wallet-record.ts';

const SECRET = 'turnstile-test-secret';
const now = Date.now();
const tester = Keypair.random();
const stranger = Keypair.random();

const env = {
  NODE_ENV: 'production',
  TURNSTILE_SECRET_KEY: SECRET,
} as NodeJS.ProcessEnv;

function signed(kp: Keypair, address = kp.publicKey()) {
  const message = walletProofMessage('faucet', address, now);
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return { message, signature: Buffer.from(kp.sign(digest)).toString('base64') };
}

async function post(body: unknown, { human = true } = {}): Promise<Request> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (human) headers.cookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(SECRET))}`;
  return new Request('https://app.changuito.me/api/faucet', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function refusal(res: unknown): Promise<{ status: number; error: string }> {
  assert.ok(res instanceof Response, 'expected a refusal');
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
}

describe('POST /api/faucet gate', () => {
  it('lets a granted wallet through with a signed session proof', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(res, { address: tester.publicKey(), kind: 'account', network: DEFAULT_NETWORK });
    assert.equal(book.inserts(), 0);
  });

  it('refuses to fund in modo real, and refuses a network it does not know', async () => {
    const real = await gateFaucet(
      await post({ address: tester.publicKey(), proof: signed(tester), network: 'mainnet' }),
      env,
      now,
      memoryCounter(),
    );
    assert.deepEqual(await refusal(real), { status: 403, error: 'faucet_not_on_network' });

    const typo = await gateFaucet(
      await post({ address: tester.publicKey(), proof: signed(tester), network: 'main' }),
      env,
      now,
      memoryCounter(),
    );
    assert.equal((await refusal(typo)).status, 400);
  });

  it('refuses a missing or forged login proof and does not insert a wallet', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const missing = await gateFaucet(await post({ address: tester.publicKey() }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(missing), { status: 401, error: 'faucet_session_required' });
    assert.equal(book.inserts(), 0);

    const forged = { ...signed(stranger, tester.publicKey()) };
    const bad = await gateFaucet(await post({ address: tester.publicKey(), proof: forged }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(bad), { status: 401, error: 'faucet_proof_invalid' });
  });

  it('refuses a wallet that is not granted or is banned', async () => {
    const ungranted = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter());
    assert.deepEqual(await refusal(ungranted), { status: 403, error: 'faucet_not_allowed' });
    const strangerRes = await gateFaucet(await post({ address: stranger.publicKey(), proof: signed(stranger) }), env, now, memoryCounter());
    assert.deepEqual(await refusal(strangerRes), { status: 403, error: 'faucet_not_allowed' });

    const book = memoryWallets([{ address: tester.publicKey(), banned: true, faucetAllowed: true }]);
    const banned = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, memoryCounter(), book.directory);
    assert.deepEqual(await refusal(banned), { status: 403, error: 'wallet_banned' });
    assert.equal(book.inserts(), 0);
  });

  it('still requires the human cookie first', async () => {
    const res = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }, { human: false }), env, now, memoryCounter());
    assert.deepEqual(await refusal(res), { status: 403, error: 'solo_humanos' });
  });

  it('holds a second grant inside the cooldown and stops at the hourly ceiling', async () => {
    const book = memoryWallets([{ address: tester.publicKey(), faucetAllowed: true }]);
    const store = memoryCounter();
    const first = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, store, book.directory);
    assert.ok(!(first instanceof Response));
    const second = await gateFaucet(await post({ address: tester.publicKey(), proof: signed(tester) }), env, now, store, book.directory);
    assert.deepEqual(await refusal(second), { status: 429, error: 'rate_limited' });

    const ceiling = memoryCounter();
    const open = memoryWallets([], true);
    const testers = Array.from({ length: FAUCET_GRANTS_PER_HOUR + 1 }, () => Keypair.random());
    const results: unknown[] = [];
    for (const kp of testers) {
      results.push(await gateFaucet(await post({ address: kp.publicKey(), proof: signed(kp) }), env, now, ceiling, open.directory));
    }
    assert.equal(results.filter((r) => !(r instanceof Response)).length, FAUCET_GRANTS_PER_HOUR);
    assert.deepEqual(await refusal(results.at(-1)), { status: 429, error: 'rate_limited' });
  });
});

function memoryWallets(seed: { address: string; banned?: boolean; faucetAllowed?: boolean }[] = [], open = false): {
  directory: WalletDirectory;
  inserts: () => number;
} {
  const rows = new Map<string, { faucetAllowed: boolean; banned: boolean }>();
  let inserts = 0;
  for (const row of seed) rows.set(`testnet:${row.address}`, { faucetAllowed: row.faucetAllowed === true, banned: row.banned === true });
  function read(network: NetworkId, address: string): WalletStanding {
    const row = rows.get(`${network}:${address}`);
    if (!row) return { network, faucetAllowed: false, banned: false, stored: false, analyticsId: null };
    return { network, faucetAllowed: row.faucetAllowed, banned: row.banned, stored: true, analyticsId: null };
  }
  return {
    inserts: () => inserts,
    directory: {
      async register(network, address) {
        const key = `${network}:${address}`;
        if (!rows.has(key)) {
          rows.set(key, { faucetAllowed: false, banned: false });
          inserts += 1;
        }
        return read(network, address);
      },
      async standing(network, address) {
        return read(network, address);
      },
      async openToAll() {
        return open;
      },
    },
  };
}
