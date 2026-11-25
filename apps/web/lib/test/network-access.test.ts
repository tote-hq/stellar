import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import { DEFAULT_NETWORK, isConfigured } from '../deployments.ts';
import { denyNetwork, networkAccess, realModeAllowlist, realModeMode } from '../network-access.ts';

const tester = Keypair.random();
const stranger = Keypair.random();

const prod = { NODE_ENV: 'production', REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() } as NodeJS.ProcessEnv;
const empty = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

describe('real mode allowlist', () => {
  it('picks disabled, open, allowlist or public from the environment', () => {
    assert.equal(realModeMode(empty), 'disabled');
    assert.equal(realModeMode({ NODE_ENV: 'production', REAL_MODE_ALLOWLIST_ADDRESSES: ' , ' } as NodeJS.ProcessEnv), 'disabled');
    for (const off of ['', 'false', '0', 'off']) {
      assert.equal(realModeMode({ NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: off } as NodeJS.ProcessEnv), 'disabled');
    }
    assert.equal(realModeMode({ NODE_ENV: 'production', FAUCET_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv), 'disabled');

    assert.equal(realModeMode(dev), 'open');

    assert.equal(realModeMode(prod), 'allowlist');
    assert.equal(
      realModeMode({ NODE_ENV: 'development', REAL_MODE_ALLOWLIST_ADDRESSES: tester.publicKey() } as NodeJS.ProcessEnv),
      'allowlist',
    );

    const open = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(realModeMode(open), 'public');
    assert.equal(realModeMode({ ...prod, REAL_MODE_OPEN_TO_ALL: 'true' } as NodeJS.ProcessEnv), 'public');
    assert.equal(realModeMode({ NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: 'yes' } as NodeJS.ProcessEnv), 'public');
  });

  it('reads commas, spaces and newlines, and drops what is not a G… address', () => {
    const list = realModeAllowlist({
      NODE_ENV: 'production',
      REAL_MODE_ALLOWLIST_ADDRESSES: `${tester.publicKey()},\n ${stranger.publicKey()} tester@example.com CABC`,
    } as NodeJS.ProcessEnv);
    assert.deepEqual([...list].sort(), [tester.publicKey(), stranger.publicKey()].sort());
    const c = 'CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557';
    assert.equal(realModeAllowlist({ NODE_ENV: 'production', REAL_MODE_ALLOWLIST_ADDRESSES: c } as NodeJS.ProcessEnv).size, 0);
  });
});

describe('networkAccess', () => {
  it('never gates the default network — it cannot spend anything', () => {
    for (const env of [prod, empty, dev]) {
      const access = networkAccess(stranger.publicKey(), DEFAULT_NETWORK, env);
      assert.equal(access.allowed, true, 'anyone may use modo prueba');
    }
  });

  it('separates who may use mainnet from whether it is up', () => {
    const allowed = networkAccess(tester.publicKey(), 'mainnet', prod);
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.configured, isConfigured('mainnet'));
    assert.equal(allowed.usable, allowed.allowed && allowed.configured);

    assert.equal(networkAccess(stranger.publicKey(), 'mainnet', prod).allowed, false);
    assert.equal(networkAccess(tester.publicKey(), 'mainnet', empty).allowed, false);
    assert.equal(networkAccess(` ${tester.publicKey().toLowerCase()} `, 'mainnet', prod).allowed, true);

    const open = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: '1' } as NodeJS.ProcessEnv;
    assert.equal(networkAccess(stranger.publicKey(), 'mainnet', open).allowed, true);
    assert.equal(denyNetwork(stranger.publicKey(), 'mainnet', open)?.error, isConfigured('mainnet') ? undefined : 'network_not_deployed');

    const yes = { NODE_ENV: 'production', REAL_MODE_OPEN_TO_ALL: 'yes' } as NodeJS.ProcessEnv;
    const access = networkAccess(stranger.publicKey(), 'mainnet', yes);
    assert.equal(access.configured, isConfigured('mainnet'));
    assert.equal(access.usable, access.allowed && access.configured);
  });
});

describe('denyNetwork', () => {
  it('lets the default network through for everybody', () => {
    assert.equal(denyNetwork(stranger.publicKey(), DEFAULT_NETWORK, empty), null);
  });

  it('RULE: tells a stranger only that they may not, never whether it is deployed', () => {
    const denial = denyNetwork(stranger.publicKey(), 'mainnet', prod);
    assert.equal(denial?.status, 403);
    assert.equal(denial?.error, 'network_not_allowed');
  });

  it('tells somebody allowed that it is not up yet, while it is not', () => {
    const denial = denyNetwork(tester.publicKey(), 'mainnet', prod);
    if (isConfigured('mainnet')) {
      assert.equal(denial, null);
    } else {
      assert.equal(denial?.error, 'network_not_deployed');
    }
  });
});
