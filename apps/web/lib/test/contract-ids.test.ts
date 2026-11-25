import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { contractIds, CONTRACT_ID_VAR_NAMES } from '../contract-ids.ts';
import { DEPLOYMENTS } from '../deployments.ts';

const CIRCLE_ESCROW = 'CDBGEMWESQJNEGBJ46TMPXNI5KFZN5B23W6ACO6NZFQATWWYY2WW3HDF';
const NAMES = CONTRACT_ID_VAR_NAMES;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) {
    const previous = saved[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

describe('contractIds', () => {
  it('uses the recorded deploy when the Worker variables are unset', () => {
    for (const name of NAMES) delete process.env[name];
    assert.deepEqual(contractIds('testnet'), {
      escrowId: DEPLOYMENTS.testnet.escrowId,
      usdcId: DEPLOYMENTS.testnet.usdcId,
    });
  });

  it('lets a runtime variable replace the recorded contract', () => {
    process.env.STELLAR_ESCROW_ID = CIRCLE_ESCROW;
    const ids = contractIds('testnet');
    assert.equal(ids.escrowId, CIRCLE_ESCROW);
    assert.equal(ids.usdcId, DEPLOYMENTS.testnet.usdcId);
  });

  it('still refuses mainnet while that network has no recorded deploy', () => {
    // A testnet id, on either variable, must not become the mainnet contract.
    process.env.STELLAR_ESCROW_ID = CIRCLE_ESCROW;
    process.env.STELLAR_ESCROW_ID_MAINNET = CIRCLE_ESCROW;
    assert.throws(() => contractIds('mainnet'), /No hay contratos desplegados en mainnet/);
  });
});
