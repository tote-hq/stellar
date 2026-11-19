import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { modeForSession, modeKeepsRecords, sessionNetwork } from '../app-mode.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';

describe('app mode', () => {
  it('preview is an unsigned session: no records, on the network that cannot spend', () => {
    // One input decides the mode: whether Pollar signed them in. A guest
    // keeps nothing, and the first paint is already the network that cannot
    // spend, whatever network string arrived with them.
    assert.equal(modeForSession(false), 'preview');
    assert.equal(modeKeepsRecords('preview'), false);
    assert.equal(sessionNetwork(false, null, DEFAULT_NETWORK), DEFAULT_NETWORK);
    assert.equal(sessionNetwork(false, 'testnet', DEFAULT_NETWORK), DEFAULT_NETWORK);
    assert.equal(sessionNetwork(false, 'mainnet', DEFAULT_NETWORK), DEFAULT_NETWORK);
  });

  it('production is a signed session: records stay, on the network the login key chose', () => {
    // Mode and network are independent. Production on testnet is valid:
    // the session decides who pays, the Pollar key decides the chain.
    assert.equal(modeForSession(true), 'production');
    assert.equal(modeKeepsRecords('production'), true);
    assert.equal(sessionNetwork(true, 'testnet', DEFAULT_NETWORK), 'testnet');
    assert.equal(sessionNetwork(true, 'mainnet', DEFAULT_NETWORK), 'mainnet');
  });
});
