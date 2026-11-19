import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import {
  parseWalletProofMessage,
  signWalletProof,
  WALLET_PROOF_TTL_MS,
  type WalletIntent,
  walletProofMessage,
} from '../wallet-proof.ts';
import { verifySep53, verifyWalletProof } from '../wallet-proof-verify.ts';

const now = 1_790_000_000_000;
const buyer = Keypair.random();
const stranger = Keypair.random();
const ORDER = 'a'.repeat(64);
/**
 * Every intent there is. Not a list kept by hand: `Record<WalletIntent, …>`
 * makes the compiler refuse an incomplete one, so adding an intent to
 * wallet-proof.ts and not to this file does not typecheck.
 */
const INTENTS: Record<WalletIntent, true> = {
  login: true,
  faucet: true,
  deposit: true,
  settle: true,
  refund: true,
  card: true,
  orders: true,
  retire: true,
};
const ALL_INTENTS = Object.keys(INTENTS) as WalletIntent[];
const OTHER = 'b'.repeat(64);

/** What Pollar's custodial signer and Freighter both produce for SEP-53. */
function sep53(kp: Keypair, message: string): string {
  const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`, 'utf8').digest();
  return Buffer.from(kp.sign(digest)).toString('base64');
}

const proof = (kp: Keypair, message: string) => ({ message, signature: sep53(kp, message) });

describe('walletProofMessage', () => {
  it('round-trips every intent', () => {
    for (const intent of ALL_INTENTS) {
      const ref = intent === 'settle' || intent === 'refund' ? ORDER : undefined;
      assert.deepEqual(parseWalletProofMessage(walletProofMessage(intent, buyer.publicKey(), now, ref)), {
        intent,
        address: buyer.publicKey(),
        issuedAt: now,
        ...(ref ? { ref } : {}),
      });
    }
  });

  it('rejects a wrong message, including surrounding whitespace', () => {
    const login = walletProofMessage('login', buyer.publicKey(), now);
    assert.equal(parseWalletProofMessage('hola'), null);
    assert.equal(parseWalletProofMessage(login + ' extra'), null);
    assert.equal(parseWalletProofMessage(` ${login}`), null);
    assert.equal(parseWalletProofMessage(`${login} `), null);
    assert.equal(parseWalletProofMessage(walletProofMessage('settle', buyer.publicKey(), now)), null);
    const smuggled = `Changuito: ver los datos de mi tarjeta ${ORDER} con ${buyer.publicKey()} (${new Date(now).toISOString()})`;
    assert.equal(parseWalletProofMessage(smuggled), null);
  });
});

describe('verifySep53', () => {
  it('accepts the wallet’s own signature and nobody else’s', () => {
    const message = walletProofMessage('login', buyer.publicKey(), now);
    const signature = sep53(buyer, message);
    assert.equal(verifySep53(buyer.publicKey(), message, signature), true);
    // Foreign key, wrong message, forged signature.
    assert.equal(verifySep53(stranger.publicKey(), message, signature), false);
    assert.equal(verifySep53(buyer.publicKey(), message + '.', signature), false);
    assert.equal(verifySep53(buyer.publicKey(), message, 'bm9wZQ=='), false);
    assert.equal(verifySep53('not-an-address', message, signature), false);
  });
});

describe('verifyWalletProof', () => {
  const check = (p: unknown, intent: WalletIntent = 'login', ref?: string, at = now) =>
    verifyWalletProof({ intent, address: buyer.publicKey(), proof: p as never, now: at, ref });

  it('accepts a fresh proof for the right intent, wallet and order', () => {
    assert.deepEqual(check(proof(buyer, walletProofMessage('login', buyer.publicKey(), now))), { ok: true });
    assert.deepEqual(check(proof(buyer, walletProofMessage('refund', buyer.publicKey(), now, ORDER)), 'refund', ORDER), {
      ok: true,
    });
    assert.deepEqual(check(proof(buyer, walletProofMessage('card', buyer.publicKey(), now)), 'card'), { ok: true });
  });

  it('says a proof is missing when there is none', () => {
    for (const p of [undefined, null, {}, { message: 'x' }, { signature: 'y' }]) {
      assert.deepEqual(check(p), { ok: false, error: 'proof_missing' });
    }
  });

  it('refuses a forged, foreign or rebound proof', () => {
    const login = proof(buyer, walletProofMessage('login', buyer.publicKey(), now));
    assert.deepEqual(check(login, 'settle', ORDER), { ok: false, error: 'proof_invalid' });
    const refund = proof(buyer, walletProofMessage('refund', buyer.publicKey(), now, ORDER));
    assert.deepEqual(check(refund, 'settle', ORDER), { ok: false, error: 'proof_invalid' });
    const other = proof(buyer, walletProofMessage('settle', buyer.publicKey(), now, OTHER));
    assert.deepEqual(check(other, 'settle', ORDER), { ok: false, error: 'proof_invalid' });
    const foreign = proof(stranger, walletProofMessage('login', buyer.publicKey(), now));
    assert.deepEqual(check(foreign), { ok: false, error: 'proof_invalid' });

    for (const intent of ['login', 'faucet', 'deposit'] as const) {
      const p = proof(buyer, walletProofMessage(intent, buyer.publicKey(), now));
      assert.deepEqual(
        verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: p, now }),
        { ok: false, error: 'proof_invalid' },
        `a ${intent} proof was accepted as a card proof`,
      );
    }
    for (const intent of ['settle', 'refund'] as const) {
      const p = proof(buyer, walletProofMessage(intent, buyer.publicKey(), now, ORDER));
      assert.deepEqual(
        verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: p, now }),
        { ok: false, error: 'proof_invalid' },
        `a ${intent} proof was accepted as a card proof`,
      );
    }
    const card = proof(buyer, walletProofMessage('card', buyer.publicKey(), now));
    for (const intent of ['login', 'faucet', 'deposit'] as const) {
      assert.equal(
        verifyWalletProof({ intent, address: buyer.publicKey(), proof: card, now }).ok,
        false,
        `a card proof was accepted as a ${intent} proof`,
      );
    }
    const theirs = proof(stranger, walletProofMessage('card', stranger.publicKey(), now));
    assert.equal(verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: theirs, now }).ok, false);
    const forged = proof(stranger, walletProofMessage('card', buyer.publicKey(), now));
    assert.deepEqual(verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: forged, now }), {
      ok: false,
      error: 'proof_invalid',
    });
  });

  it('refuses a stale proof and one from too far ahead', () => {
    const p = proof(buyer, walletProofMessage('login', buyer.publicKey(), now));
    assert.deepEqual(check(p, 'login', undefined, now + WALLET_PROOF_TTL_MS + 1), { ok: false, error: 'proof_expired' });
    const ahead = proof(buyer, walletProofMessage('login', buyer.publicKey(), now + 5 * 60_000));
    assert.deepEqual(check(ahead), { ok: false, error: 'proof_expired' });
    const card = proof(buyer, walletProofMessage('card', buyer.publicKey(), now));
    assert.deepEqual(
      verifyWalletProof({ intent: 'card', address: buyer.publicKey(), proof: card, now: now + WALLET_PROOF_TTL_MS + 1 }),
      { ok: false, error: 'proof_expired' },
    );
  });
});

describe('signWalletProof', () => {
  it('returns null when the wallet declines or throws', async () => {
    assert.equal(await signWalletProof(async () => null, 'login', buyer.publicKey()), null);
    assert.equal(
      await signWalletProof(
        async () => {
          throw new Error('no');
        },
        'login',
        buyer.publicKey(),
      ),
      null,
    );
  });

  it('pairs the message it built with the signature', async () => {
    const p = await signWalletProof(async (m) => sep53(buyer, m), 'login', buyer.publicKey(), undefined, now);
    assert.ok(p);
    assert.deepEqual(verifyWalletProof({ intent: 'login', address: buyer.publicKey(), proof: p, now }), { ok: true });
  });
});
