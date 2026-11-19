import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_NETWORK, NETWORK_IDS } from '../deployments.ts';
import { requestNetwork, servedNetworks } from '../server-network.ts';

describe('servedNetworks', () => {
  it('serves the networks the login key allows', () => {
    // No key must leave behaviour unchanged: the mainnet gates (allowlist,
    // proof, isConfigured) decide. Only a testnet key shrinks the set.
    // A mainnet login key still serves every network.
    assert.deepEqual(servedNetworks(null, DEFAULT_NETWORK), [...NETWORK_IDS]);
    assert.deepEqual(servedNetworks('testnet', DEFAULT_NETWORK), ['testnet']);
    assert.deepEqual(servedNetworks('mainnet', DEFAULT_NETWORK), [...NETWORK_IDS]);
  });
});

describe('requestNetwork', () => {
  it('defaults an absent value and accepts the login network', () => {
    assert.deepEqual(requestNetwork(undefined, 'testnet'), { ok: true, network: 'testnet' });
    assert.deepEqual(requestNetwork(null, 'testnet'), { ok: true, network: 'testnet' });
    assert.deepEqual(requestNetwork('', 'testnet'), { ok: true, network: 'testnet' });
    assert.deepEqual(requestNetwork('testnet', 'testnet'), { ok: true, network: 'testnet' });
    assert.deepEqual(requestNetwork('futurenet', 'testnet', DEFAULT_NETWORK, 'default'), {
      ok: true,
      network: 'testnet',
    });
    assert.deepEqual(requestNetwork('MAINNET', null, DEFAULT_NETWORK, 'default'), {
      ok: true,
      network: 'testnet',
    });
  });

  it('RULE: a testnet-only deployment refuses a network it does not serve', () => {
    // The whole point of the choke point: never coerce to the default, never
    // reach DEPLOYMENTS.mainnet from a request that named the wrong chain.
    assert.deepEqual(requestNetwork('mainnet', 'testnet', DEFAULT_NETWORK), {
      ok: false,
      error: 'network_not_served',
    });
    assert.deepEqual(requestNetwork('futurenet', 'testnet', DEFAULT_NETWORK, 'refuse'), {
      ok: false,
      error: 'network_not_served',
    });
    assert.deepEqual(requestNetwork('mainnet', 'testnet', DEFAULT_NETWORK, 'default'), {
      ok: false,
      error: 'network_not_served',
    });
  });
});
