import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LOGIN_NETWORK, loginNetwork, pollarEnabled, pollarEnabledOn, pollarNetwork, shortAddress } from '../pollar.ts';
import { DEPLOYMENTS, NETWORK_IDS } from '../deployments.ts';
import { addressKind } from '../stellar.ts';

describe('shortAddress', () => {
  it('keeps both ends, which are the parts a person compares', () => {
    assert.equal(shortAddress(DEPLOYMENTS.testnet.resolver), 'GBXB…YGN5');
  });
});

describe('addressKind', () => {
  it('knows a classic account from a contract', () => {
    // Both turn up as wallets: a Pollar internal wallet is a G-address, a
    // passkey smart wallet is a deployed contract.
    assert.equal(addressKind(DEPLOYMENTS.testnet.resolver), 'account');
    assert.equal(addressKind(DEPLOYMENTS.testnet.escrowId), 'contract');
    assert.equal(addressKind(DEPLOYMENTS.testnet.usdcId), 'contract');
  });

  it('rejects anything else rather than handing it to RPC', () => {
    for (const bad of [
      '',
      'nonsense',
      'GBGM…HTFK', // the shortened form, pasted back in
      DEPLOYMENTS.testnet.resolver.slice(0, -1),
      `${DEPLOYMENTS.testnet.resolver}A`,
      'SDJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', // a secret
    ]) {
      assert.equal(addressKind(bad), null, `${bad.slice(0, 12)} was accepted`);
    }
  });
});

describe('pollarNetwork', () => {
  it('RULE: asks Pollar for the same chain the contracts are on', () => {
    // Pollar's wallet and our escrow have to agree, or the user signs a
    // transaction on one chain against a contract that lives on another. Our
    // ids and Pollar's happen to be the same two words; this keeps that a
    // fact we assert rather than one we assume.
    for (const net of NETWORK_IDS) {
      assert.equal(pollarNetwork(net), DEPLOYMENTS[net].id);
    }
  });

  it('RULE: the login network follows the Pollar key, not a hard-coded chain', () => {
    // Derived from which key is set (testnet wins when both are). With neither
    // key set — the unit-test default — there is no login network at all, and
    // that is not the same as asking Pollar for DEFAULT_NETWORK.
    // Mode follows the session; network follows the key. LOGIN_NETWORK is
    // whatever loginNetwork returns from the env keys — null, testnet, or
    // mainnet — never a hard-coded 'mainnet'. pollarEnabled is exactly
    // "is there a login network".
    assert.equal(
      LOGIN_NETWORK,
      loginNetwork({
        testnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? '',
        mainnet: process.env.NEXT_PUBLIC_POLLAR_API_KEY_MAINNET ?? '',
      }),
    );
    if (LOGIN_NETWORK === null) {
      assert.equal(pollarEnabled, false);
    } else {
      assert.equal(pollarNetwork(LOGIN_NETWORK), LOGIN_NETWORK);
      assert.equal(pollarEnabled, pollarEnabledOn(LOGIN_NETWORK));
    }
    assert.equal(pollarEnabled, LOGIN_NETWORK !== null);
    assert.ok(
      LOGIN_NETWORK === null || LOGIN_NETWORK === 'testnet' || LOGIN_NETWORK === 'mainnet',
    );
  });
});
