import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_TOPUP_CEILING_UNITS, demoTopUpShortfall } from '../checkout/demo-topup.ts';

describe('demoTopUpShortfall', () => {
  it('tops an empty wallet up to 1000 USDC and stops there', () => {
    assert.equal(DEMO_TOPUP_CEILING_UNITS, 10_000_000_000n);
    assert.equal(demoTopUpShortfall(0n), 10_000_000_000n);
    assert.equal(demoTopUpShortfall(-1n), 10_000_000_000n);
    assert.equal(demoTopUpShortfall(2_000_000_000n), 8_000_000_000n);
    assert.equal(demoTopUpShortfall(10_000_000_000n), 0n);
    assert.equal(demoTopUpShortfall(10_000_000_001n), 0n);
  });
});
