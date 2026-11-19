import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COOLDOWN_MS,
  ENOUGH_UNITS,
  GRANT_UNITS,
  faucetVerdict,
} from '../faucet-policy.ts';

const now = 1_760_000_000_000;

describe('faucetVerdict', () => {
  it('funds an empty or low wallet and stops once it clearly has enough', () => {
    const empty = faucetVerdict({ balanceUnits: 0n, now });
    assert.deepEqual(empty, { allow: true, amount: GRANT_UNITS });
    assert.equal(faucetVerdict({ balanceUnits: ENOUGH_UNITS - 1n, now }).allow, true);
    const enough = faucetVerdict({ balanceUnits: ENOUGH_UNITS, now });
    assert.equal(enough.allow, false);
    assert.match(enough.allow === false ? enough.reason : '', /suficiente/);
    assert.ok(GRANT_UNITS < ENOUGH_UNITS, 'one grant should not cross the enough line');
  });

  it('holds a second request inside the cooldown and lets the next through once it has passed', () => {
    const held = faucetVerdict({ balanceUnits: 0n, lastGrantAt: now - 10_000, now });
    assert.equal(held.allow, false);
    assert.equal(held.allow === false ? held.retryInMs : -1, COOLDOWN_MS - 10_000);
    assert.equal(faucetVerdict({ balanceUnits: 0n, lastGrantAt: now - COOLDOWN_MS, now }).allow, true);
  });

  it('treats a clock that went backwards as too soon, not as permission', () => {
    // Two lambdas with skewed clocks, or a redeploy. The safe reading of "the
    // last grant is in the future" is to wait, not to mint.
    const v = faucetVerdict({ balanceUnits: 0n, lastGrantAt: now + 5_000, now });
    assert.equal(v.allow, false);
    assert.equal(v.allow === false ? v.retryInMs : -1, COOLDOWN_MS);
  });
});
