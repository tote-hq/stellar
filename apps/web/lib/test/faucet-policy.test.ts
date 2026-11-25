import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CAP_UNITS,
  CHUNK_UNITS,
  COOLDOWN_MS,
  chunksForShortfall,
  faucetMint,
  faucetVerdict,
} from '../faucet-policy.ts';

const now = 1_760_000_000_000;

describe('faucetMint', () => {
  it('grants +100 from empty, clips 950→+50, and stops at the 1000 cap', () => {
    assert.equal(faucetMint(0n), CHUNK_UNITS);
    assert.equal(faucetMint(0n, 1), 1_000_000_000n);
    assert.equal(faucetMint(9_500_000_000n, 1), 500_000_000n);
    assert.equal(faucetMint(CAP_UNITS), 0n);
    assert.equal(faucetMint(CAP_UNITS + 1n), 0n);
  });

  it('honours multi-chunk requests without crossing the cap', () => {
    assert.equal(faucetMint(0n, 2), 2_000_000_000n);
    assert.equal(faucetMint(1_500_000_000n, 2), 2_000_000_000n);
    assert.equal(faucetMint(9_000_000_000n, 3), 1_000_000_000n);
  });
});

describe('chunksForShortfall', () => {
  it('covers a lock shortfall in one POST of N×100 chunks', () => {
    assert.equal(chunksForShortfall(0n, 0n), 0);
    assert.equal(chunksForShortfall(1_500_000_000n, 3_500_000_000n), 2);
    assert.equal(chunksForShortfall(0n, 10_000_000_000n), 10);
    assert.equal(chunksForShortfall(0n, 11_000_000_000n), 10);
  });
});

describe('faucetVerdict', () => {
  it('funds an empty or low wallet and stops at the 1000 USDC cap', () => {
    const empty = faucetVerdict({ balanceUnits: 0n, now });
    assert.deepEqual(empty, { allow: true, amount: CHUNK_UNITS });
    assert.equal(faucetVerdict({ balanceUnits: CAP_UNITS - 1n, now }).allow, true);
    const enough = faucetVerdict({ balanceUnits: CAP_UNITS, now });
    assert.equal(enough.allow, false);
    assert.equal(enough.allow === false ? enough.reasonKind : '', 'cap');
    assert.match(enough.allow === false ? enough.reason : '', /máximo|1000/);
  });

  it('holds a second request inside the cooldown and lets the next through once it has passed', () => {
    const held = faucetVerdict({ balanceUnits: 0n, lastGrantAt: now - 10_000, now });
    assert.equal(held.allow, false);
    assert.equal(held.allow === false ? held.reasonKind : '', 'cooldown');
    assert.equal(held.allow === false ? held.retryInMs : -1, COOLDOWN_MS - 10_000);
    assert.equal(faucetVerdict({ balanceUnits: 0n, lastGrantAt: now - COOLDOWN_MS, now }).allow, true);
  });

  it('treats a clock that went backwards as too soon, not as permission', () => {
    const v = faucetVerdict({ balanceUnits: 0n, lastGrantAt: now + 5_000, now });
    assert.equal(v.allow, false);
    assert.equal(v.allow === false ? v.reasonKind : '', 'cooldown');
    assert.equal(v.allow === false ? v.retryInMs : -1, COOLDOWN_MS);
  });
});
