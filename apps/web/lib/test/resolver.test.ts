import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { mockBindings } from './support/fake-soroban.ts';

/**
 * lib/server/resolver.ts, the one hot key that mints, settles and refunds.
 * Every refusal must name the variable and public keys only, never the secret
 * or any part of it, and the two networks' secrets must never stand in for
 * each other. No test holds the deployed key, so the happy path is the
 * refusal of a key the contracts were not deployed with.
 */
mockBindings();

const env = process.env as Record<string, string | undefined>;
const saved = { t: env.STELLAR_RESOLVER_SECRET, m: env.STELLAR_RESOLVER_SECRET_MAINNET };

describe('resolverKeypair', () => {
  let mod: typeof import('../server/resolver.ts');
  let expected: string;
  before(async () => {
    mod = await import('../server/resolver.ts');
    expected = (await import('../deployments.ts')).deployment('testnet').resolver;
  });
  afterEach(() => {
    env.STELLAR_RESOLVER_SECRET = saved.t;
    env.STELLAR_RESOLVER_SECRET_MAINNET = saved.m;
  });

  it('names the missing variable', () => {
    delete env.STELLAR_RESOLVER_SECRET;
    assert.throws(() => mod.resolverKeypair('testnet'), /STELLAR_RESOLVER_SECRET is not set/);
  });

  it('never echoes an invalid secret, not even a prefix', () => {
    const junk = 'SNOTAREALKEYBUTLOOKSLIKEONE1234567890ABCDEFGHIJ';
    env.STELLAR_RESOLVER_SECRET = junk;
    const err = (() => {
      try {
        mod.resolverKeypair('testnet');
      } catch (e) {
        return e as Error;
      }
    })();
    assert.ok(err);
    assert.match(err.message, /not a valid Stellar secret key/);
    assert.ok(!err.message.includes(junk.slice(0, 8)));
  });

  it('refuses a key the contracts were not deployed with, naming public keys only', () => {
    const wrong = Keypair.random();
    env.STELLAR_RESOLVER_SECRET = wrong.secret();
    const err = (() => {
      try {
        mod.resolverKeypair('testnet');
      } catch (e) {
        return e as Error;
      }
    })();
    assert.ok(err);
    assert.ok(err.message.includes(wrong.publicKey()));
    assert.ok(err.message.includes(expected));
    assert.ok(!err.message.includes(wrong.secret()));
    assert.ok(!err.message.includes(wrong.secret().slice(0, 8)));
  });

  it('the mainnet secret never signs on testnet, and the clients refuse to build without the right key', () => {
    delete env.STELLAR_RESOLVER_SECRET;
    env.STELLAR_RESOLVER_SECRET_MAINNET = Keypair.random().secret();
    assert.throws(() => mod.resolverKeypair('testnet'), /STELLAR_RESOLVER_SECRET is not set/);
    assert.throws(() => mod.escrowAsResolver('testnet'), /STELLAR_RESOLVER_SECRET is not set/);
    assert.throws(() => mod.usdcAsAdmin('testnet'), /STELLAR_RESOLVER_SECRET is not set/);
  });
});
