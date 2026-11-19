/**
 * The door in front of the deposit rail, in both of its states.
 *
 * Two flags decide who may spend real money here, and the whole point of this
 * file is that both settings are exercised rather than one: the list on, the
 * list waived, and the two ways of having no list at all. `lib/deposit-gate.ts`
 * is the only place that answers, so it is the only place that has to be right.
 *
 * The sibling suite is `faucet-auth.test.ts`, which pins the same rule for the
 * mint key. Where a case here reads like one there, that is deliberate.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK } from '../deployments.ts';
import { authorizeRealMode, realModeFor, realModeNeedsProof } from '../deposit-gate.ts';
import { WALLET_PROOF_TTL_MS, walletProofMessage, type WalletProof } from '../wallet-proof.ts';

const now = 1_790_000_000_000;
const tester = Keypair.random();
const stranger = Keypair.random();

/** What Pollar's custodial signer and Freighter both produce for SEP-53. */
function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

function proofFor(kp: Keypair, address = kp.publicKey(), at = now): WalletProof {
  const message = walletProofMessage('deposit', address, at);
  return { message, signature: sep53(kp, message) };
}

const env = (extra: Record<string, string>) => ({ NODE_ENV: 'production', ...extra }) as NodeJS.ProcessEnv;

/** The four modes, each reached the way a deployment actually reaches it. */
const OPEN = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
const ALLOWLIST = env({ REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() });
const PUBLIC = env({ REAL_MODE_OPEN_TO_ALL: '1' });
const DISABLED = env({});

/**
 * A proof that cannot be read without saying so. Passing this proves a refusal
 * happened *before* the signature was looked at, which is the ordering the gate
 * claims: a stranger is turned away on their own claimed address, and the
 * cheapest check is the first one.
 */
const untouchable = {
  get message(): string {
    throw new Error('the gate read the proof it said it would not');
  },
  get signature(): string {
    throw new Error('the gate read the proof it said it would not');
  },
} as unknown as WalletProof;

describe('modo real on the deposit rail — the four modes', () => {
  it('lets a laptop through with no signature at all (open)', () => {
    // Non-production with no list. The only mode that skips the proof, and the
    // reason `next dev` against mainnet does not need a wallet to click.
    const auth = authorizeRealMode({ address: stranger.publicKey(), proof: null, now, env: OPEN, net: 'mainnet' });
    assert.deepEqual(auth, { ok: true, mode: 'open' });
  });

  it('lets a listed wallet through once it has signed (allowlist)', () => {
    const auth = authorizeRealMode({
      address: tester.publicKey(),
      proof: proofFor(tester),
      now,
      env: ALLOWLIST,
      net: 'mainnet',
    });
    assert.deepEqual(auth, { ok: true, mode: 'allowlist' });

    const other = authorizeRealMode({
      address: stranger.publicKey(),
      proof: proofFor(stranger),
      now,
      env: ALLOWLIST,
      net: 'mainnet',
    });
    assert.equal(other.ok, false);
    assert.equal(other.ok === false && other.error, 'network_not_allowed');

    for (const raw of [
      `${stranger.publicKey()},${tester.publicKey()}`,
      `${stranger.publicKey()} ${tester.publicKey()}`,
      `${stranger.publicKey()}\n${tester.publicKey()}\n`,
    ]) {
      const listed = authorizeRealMode({
        address: tester.publicKey(),
        proof: proofFor(tester),
        now,
        env: env({ REAL_MODE_ALLOWLIST_ADDRESSES: raw }),
        net: 'mainnet',
      });
      assert.equal(listed.ok, true, raw);
    }
  });

  it('lets anybody who signs through when the flag is set (public)', () => {
    const auth = authorizeRealMode({
      address: stranger.publicKey(),
      proof: proofFor(stranger),
      now,
      env: PUBLIC,
      net: 'mainnet',
    });
    assert.deepEqual(auth, { ok: true, mode: 'public' });
  });

  it('refuses everybody in production with no list (disabled)', () => {
    const auth = authorizeRealMode({
      address: tester.publicKey(),
      proof: proofFor(tester),
      now,
      env: DISABLED,
      net: 'mainnet',
    });
    assert.equal(auth.ok, false);
    assert.equal(auth.ok === false && auth.status, 403);
    assert.equal(auth.ok === false && auth.error, 'network_not_allowed');
  });
});

describe('the two flags, which is the thing being shipped', () => {
  it('RULE: REAL_MODE_OPEN_TO_ALL waives the allowlist', () => {
    // The flag is checked before the list, so a list left over from an earlier
    // round of testers cannot quietly keep everyone else out afterwards.
    const stale = env({ REAL_MODE_OPEN_TO_ALL: '1', REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() });
    for (const kp of [tester, stranger]) {
      const auth = authorizeRealMode({ address: kp.publicKey(), proof: proofFor(kp), now, env: stale, net: 'mainnet' });
      assert.deepEqual(auth, { ok: true, mode: 'public' });
    }
    for (const off of ['', 'false', '0', 'off']) {
      const e = env({ REAL_MODE_OPEN_TO_ALL: off, REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() });
      assert.equal(realModeFor('mainnet', e), 'allowlist');
      const refused = authorizeRealMode({ address: stranger.publicKey(), proof: proofFor(stranger), now, env: e, net: 'mainnet' });
      assert.equal(refused.ok, false);
    }
  });

  it('RULE: REAL_MODE_OPEN_TO_ALL does not waive the signature', () => {
    // "Anybody may pay" and "nobody has to prove who they are" are different
    // sentences, and only the first one was asked for. A logged-in shopper
    // pays nothing for this; a script pays the whole exercise.
    const auth = authorizeRealMode({ address: stranger.publicKey(), proof: null, now, env: PUBLIC, net: 'mainnet' });
    assert.equal(auth.ok, false);
    assert.equal(auth.ok === false && auth.status, 401);
    assert.equal(auth.ok === false && auth.error, 'real_mode_session_required');
  });
});

describe('what a refusal gives away', () => {
  it('says the same thing to a stranger whether or not a list exists', () => {
    // 'disabled' and 'not on the list' are one sentence on purpose: a refusal
    // must not tell somebody whether there is a list to get onto. `untouchable`
    // throws if the proof is read, so a passing call is the ordering check.
    const off = authorizeRealMode({ address: stranger.publicKey(), proof: untouchable, now, env: DISABLED, net: 'mainnet' });
    const listed = authorizeRealMode({ address: stranger.publicKey(), proof: untouchable, now, env: ALLOWLIST, net: 'mainnet' });
    assert.deepEqual(off, listed);
    assert.doesNotThrow(() =>
      authorizeRealMode({ address: stranger.publicKey(), proof: untouchable, now, env: ALLOWLIST, net: 'mainnet' }),
    );
  });
});

describe('the proof, in every mode that asks for one', () => {
  it('refuses a stale, forged, or foreign proof and accepts a fresh one', () => {
    const gated = [
      { mode: 'allowlist' as const, env: ALLOWLIST, who: tester },
      { mode: 'public' as const, env: PUBLIC, who: stranger },
    ];
    for (const { mode, env: e, who } of gated) {
      const address = who.publicKey();
      const noProof = authorizeRealMode({ address, proof: null, now, env: e, net: 'mainnet' });
      assert.equal(noProof.ok === false && noProof.error, 'real_mode_session_required');
      assert.equal(noProof.ok === false && noProof.status, 401);

      const old = proofFor(who, address, now - WALLET_PROOF_TTL_MS - 1);
      const stale = authorizeRealMode({ address, proof: old, now, env: e, net: 'mainnet' });
      assert.equal(stale.ok === false && stale.error, 'real_mode_proof_expired');

      // The message names this address; the signature is another key's.
      const forged = { message: walletProofMessage('deposit', address, now), signature: sep53(Keypair.random(), 'x') };
      const forgedAuth = authorizeRealMode({ address, proof: forged, now, env: e, net: 'mainnet' });
      assert.equal(forgedAuth.ok === false && forgedAuth.error, 'real_mode_proof_invalid');

      const elsewhere = Keypair.random();
      const foreign = authorizeRealMode({ address, proof: proofFor(elsewhere), now, env: e, net: 'mainnet' });
      assert.equal(foreign.ok === false && foreign.error, 'real_mode_proof_invalid');

      // A login proof is not permission to spend.
      const login = walletProofMessage('login', address, now);
      const otherIntent = authorizeRealMode({
        address,
        proof: { message: login, signature: sep53(who, login) },
        now,
        env: e,
        net: 'mainnet',
      });
      assert.equal(otherIntent.ok === false && otherIntent.error, 'real_mode_proof_invalid');

      const fresh = authorizeRealMode({ address, proof: proofFor(who), now, env: e, net: 'mainnet' });
      assert.deepEqual(fresh, { ok: true, mode });
      const spaced = authorizeRealMode({ address: `  ${address}  `, proof: proofFor(who), now, env: e, net: 'mainnet' });
      assert.deepEqual(spaced, { ok: true, mode });
    }
  });
});

describe('the default network is untouched by any of this', () => {
  it('lets a guest pay in modo prueba under every flag setting', () => {
    for (const e of [OPEN, ALLOWLIST, PUBLIC, DISABLED]) {
      const auth = authorizeRealMode({ address: '', proof: untouchable, now, env: e, net: DEFAULT_NETWORK });
      assert.deepEqual(auth, { ok: true, mode: 'open' }, JSON.stringify(e));
    }
    const unnamed = authorizeRealMode({ address: '', proof: untouchable, now, env: DISABLED });
    assert.deepEqual(unnamed, { ok: true, mode: 'open' });
  });
});

describe('realModeFor / realModeNeedsProof — what the deposit gate asks', () => {
  it('reports the mode with no address to ask about', () => {
    assert.equal(realModeFor('mainnet', OPEN), 'open');
    assert.equal(realModeFor('mainnet', ALLOWLIST), 'allowlist');
    assert.equal(realModeFor('mainnet', PUBLIC), 'public');
    assert.equal(realModeFor('mainnet', DISABLED), 'disabled');
    assert.equal(realModeFor(DEFAULT_NETWORK, DISABLED), 'open');
    // If these two ever disagree, `POST /api/card` either demands an owner
    // record that `POST /api/deposit` never wrote, or skips a check it should have made.
    assert.equal(realModeNeedsProof('allowlist'), true);
    assert.equal(realModeNeedsProof('public'), true);
    assert.equal(realModeNeedsProof('open'), false);
    assert.equal(realModeNeedsProof('disabled'), false);
  });
});
