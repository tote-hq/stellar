import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';
import { readLoggedInUser, sessionSecret, USER_COOKIE, verifyUserToken } from '../login-gate.ts';
import { issueUserSession } from '../session-issue.ts';
import { walletProofMessage, type WalletIntent } from '../wallet-proof.ts';
import type { NetworkId } from '../deployments.ts';
import type { WalletDirectory, WalletStanding } from '../wallet-record.ts';

const TURNSTILE = 'turnstile-test-secret';
const SESSION = 'session-test-secret';
const now = Date.now();
const shopper = Keypair.random();
const stranger = Keypair.random();

const env = {
  NODE_ENV: 'production',
  TURNSTILE_SECRET_KEY: TURNSTILE,
  CHG_SESSION_SECRET: SESSION,
} as NodeJS.ProcessEnv;

function signed(kp: Keypair, address = kp.publicKey(), intent: WalletIntent = 'login') {
  const message = walletProofMessage(intent, address, now);
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return { message, signature: Buffer.from(kp.sign(digest)).toString('base64') };
}

async function post(body: unknown, { human = true } = {}): Promise<Request> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (human) headers.cookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(TURNSTILE))}`;
  return new Request('https://app.changuito.me/api/session/login', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function status(res: Response): Promise<{ status: number; error?: string; cookie: string | null }> {
  const json = (await res.json()) as { error?: string };
  return { status: res.status, error: json.error, cookie: res.headers.get('set-cookie') };
}

describe('POST /api/session/login', () => {
  it('refuses a bare address — the fake login', async () => {
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey() }), env, now));
    assert.equal(r.status, 401);
    assert.equal(r.error, 'session_proof_required');
    assert.equal(r.cookie, null);
  });

  it('refuses a proof that is not this wallet signing in', async () => {
    const foreign = await status(
      await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(stranger, shopper.publicKey()) }), env, now),
    );
    assert.equal(foreign.status, 401);
    assert.equal(foreign.cookie, null);

    const proof = signed(shopper, shopper.publicKey(), 'faucet');
    const other = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof }), env, now));
    assert.equal(other.status, 401);
    assert.equal(other.error, 'session_proof_invalid');
  });

  it('refuses a contract address, which cannot sign SEP-53', async () => {
    const r = await status(await issueUserSession(await post({ address: 'C' + 'A'.repeat(55) }), env, now));
    assert.equal(r.status, 400);
  });

  it('issues nothing in production without CHG_SESSION_SECRET', async () => {
    const noSecret = { ...env, CHG_SESSION_SECRET: '' } as NodeJS.ProcessEnv;
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), noSecret, now));
    assert.equal(r.status, 503);
    assert.equal(r.cookie, null);
    assert.equal(sessionSecret({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 't' } as NodeJS.ProcessEnv), '');
    assert.equal(sessionSecret({ NODE_ENV: 'production', CHG_SESSION_SECRET: ' s ' } as NodeJS.ProcessEnv), 's');
    assert.equal(sessionSecret({ NODE_ENV: 'development', TURNSTILE_SECRET_KEY: 't' } as NodeJS.ProcessEnv), 't');
    assert.equal(sessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), 'dev-chg-session-not-for-prod');
    const req = new Request('https://app.changuito.me/api/chat', { headers: { cookie: `${USER_COOKIE}=v2.1.2.3` } });
    assert.deepEqual(await readLoggedInUser(req, { NODE_ENV: 'production' } as NodeJS.ProcessEnv), { ok: false });
  });

  it('still needs the human cookie', async () => {
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }, { human: false }), env, now));
    assert.equal(r.status, 403);
  });

  it('signs a session for the wallet that proved itself and records it once', async () => {
    const book = memoryWallets();
    const res = await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), env, now, book.directory);
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') ?? '';
    const token = decodeURIComponent(/chg_user=([^;]+)/.exec(cookie)?.[1] ?? '');
    const read = await verifyUserToken(token, SESSION, now);
    assert.deepEqual(read, { ok: true, address: shopper.publicKey() });
    assert.match(cookie, /HttpOnly/);
    assert.equal(book.inserts(), 1);
    const row = await book.directory.standing('testnet', shopper.publicKey());
    assert.equal(row.stored, true);
    assert.equal(row.banned, false);
    const body = (await res.json()) as { ok: boolean; address: string; analyticsId: string | null };
    assert.equal(body.ok, true);
    assert.equal(body.address, shopper.publicKey());
    assert.equal(body.analyticsId, null);
  });

  it('returns the row analytics id and not the address', async () => {
    const analyticsId = '11111111-1111-4111-8111-111111111111';
    const book = memoryWallets([{ address: shopper.publicKey(), analyticsId }]);
    const res = await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), env, now, book.directory);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { address: string; analyticsId: string | null };
    assert.equal(body.analyticsId, analyticsId);
    assert.equal(body.address, shopper.publicKey());
    assert.notEqual(body.analyticsId, body.address);
  });

  it('refuses a banned wallet and does not set a cookie', async () => {
    const book = memoryWallets([{ address: shopper.publicKey(), banned: true, faucetAllowed: true }]);
    const r = await status(await issueUserSession(await post({ address: shopper.publicKey(), proof: signed(shopper) }), env, now, book.directory));
    assert.equal(r.status, 403);
    assert.equal(r.error, 'wallet_banned');
    assert.equal(r.cookie, null);
    assert.equal(book.inserts(), 0);
    const still = await book.directory.standing('testnet', shopper.publicKey());
    assert.equal(still.banned, true);
    assert.equal(still.faucetAllowed, true);
  });
});

function memoryWallets(seed: { address: string; banned?: boolean; faucetAllowed?: boolean; analyticsId?: string | null }[] = []): {
  directory: WalletDirectory;
  inserts: () => number;
} {
  const rows = new Map<string, { faucetAllowed: boolean; banned: boolean; analyticsId: string | null }>();
  let inserts = 0;
  for (const row of seed) {
    rows.set(`testnet:${row.address}`, {
      faucetAllowed: row.faucetAllowed === true,
      banned: row.banned === true,
      analyticsId: row.analyticsId ?? null,
    });
  }
  function read(network: NetworkId, address: string): WalletStanding {
    const row = rows.get(`${network}:${address}`);
    if (!row) return { network, faucetAllowed: false, banned: false, stored: false, analyticsId: null };
    return { network, faucetAllowed: row.faucetAllowed, banned: row.banned, stored: true, analyticsId: row.analyticsId };
  }
  return {
    inserts: () => inserts,
    directory: {
      async register(network, address) {
        const key = `${network}:${address}`;
        if (!rows.has(key)) {
          rows.set(key, { faucetAllowed: false, banned: false, analyticsId: null });
          inserts += 1;
        }
        return read(network, address);
      },
      async standing(network, address) {
        return read(network, address);
      },
      async openToAll() {
        return false;
      },
    },
  };
}
