import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_TOPUP_CEILING_UNITS, CHUNK_UNITS, chunksForShortfall, faucetMint } from '../checkout/demo-topup.ts';

describe('demo top-up re-exports faucet chunk + cap', () => {
  it('exposes the 1000 USDC cap and +100 chunk mint', () => {
    assert.equal(DEMO_TOPUP_CEILING_UNITS, 10_000_000_000n);
    assert.equal(CHUNK_UNITS, 1_000_000_000n);
    assert.equal(faucetMint(0n), CHUNK_UNITS);
    assert.equal(faucetMint(9_500_000_000n), 500_000_000n);
    assert.equal(chunksForShortfall(1_500_000_000n, 3_500_000_000n), 2);
  });
});
