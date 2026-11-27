import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Asset } from '@stellar/stellar-sdk';

import { __setConfigForTests, getUsdcSource, usdcLineSource, usdcSource } from '../config.ts';
import { CIRCLE_TESTNET_USDC, DEPLOYMENTS } from '../deployments.ts';

describe('usdc source reader', () => {
  afterEach(() => {
    __setConfigForTests(null);
  });

  it('reads only the key for that session', () => {
    const values = { usdc_source_guest: 'circle', usdc_source_signed_in: 'mock' };
    assert.equal(usdcSource(values, false), 'circle');
    assert.equal(usdcSource(values, true), 'mock');
    const flipped = { usdc_source_guest: 'mock', usdc_source_signed_in: 'circle' };
    assert.equal(usdcSource(flipped, false), 'mock');
    assert.equal(usdcSource(flipped, true), 'circle');
  });

  it('returns circle only for the exact string', () => {
    for (const junk of [true, false, 'Circle', 'mainnet', 'CIRCLE', null, 1, 'mock', '', ' circle']) {
      assert.equal(usdcSource({ usdc_source_guest: junk }, false), 'mock', String(junk));
      assert.equal(usdcSource({ usdc_source_signed_in: junk }, true), 'mock', String(junk));
    }
    assert.equal(usdcSource({ usdc_source_guest: 'circle' }, false), 'circle');
  });

  it('a missing row, an empty table and no database all read as mock, and the keys stay independent', async () => {
    assert.equal(usdcSource({}, false), 'mock');
    assert.equal(usdcSource({}, true), 'mock');
    assert.equal(usdcSource({ usdc_source_guest: 'circle' }, true), 'mock');
    assert.equal(usdcSource({ usdc_source_signed_in: 'circle' }, false), 'mock');

    __setConfigForTests(null);
    delete process.env.DATABASE_URL;
    assert.equal(await getUsdcSource(false), 'mock');
    assert.equal(await getUsdcSource(true), 'mock');

    __setConfigForTests({});
    assert.equal(await getUsdcSource(true), 'mock');
  });

  it('mainnet ignores a circle flag', () => {
    const values = { usdc_source_guest: 'circle', usdc_source_signed_in: 'circle' };
    assert.equal(usdcLineSource('mainnet', values, true), 'mock');
    assert.equal(usdcLineSource('mainnet', values, false), 'mock');
    assert.equal(usdcLineSource('testnet', values, true), 'circle');
  });

  it('names Circle testnet USDC from the published Stellar testnet row', () => {
    assert.equal(CIRCLE_TESTNET_USDC.code, 'USDC');
    assert.equal(CIRCLE_TESTNET_USDC.issuer, 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
    assert.notEqual(CIRCLE_TESTNET_USDC.issuer, DEPLOYMENTS.mainnet.usdcIssuer);
    const id = new Asset(CIRCLE_TESTNET_USDC.code, CIRCLE_TESTNET_USDC.issuer).contractId(
      DEPLOYMENTS.testnet.networkPassphrase,
    );
    assert.match(id, /^C[A-Z2-7]{55}$/);
    assert.notEqual(id, DEPLOYMENTS.testnet.usdcId);
  });
});
