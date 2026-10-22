import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatTrailMs } from '../tool-duration.ts';

describe('formatTrailMs', () => {
  it('does not round a sub-tenth call down to 0.0s', () => {
    // (ms / 1000).toFixed(1) prints "0.0s" below 50ms and "0.1s" from 50ms,
    // which overstates anything under a tenth. The row says it was shorter.
    assert.equal(formatTrailMs(0), '<0.1s');
    assert.equal(formatTrailMs(12), '<0.1s');
    assert.equal(formatTrailMs(49), '<0.1s');
    assert.equal(formatTrailMs(50), '<0.1s');
    assert.equal(formatTrailMs(99), '<0.1s');
  });

  it('keeps tenths from a tenth of a second upward', () => {
    assert.equal(formatTrailMs(100), '0.1s');
    assert.equal(formatTrailMs(149), '0.1s');
    assert.equal(formatTrailMs(1500), '1.5s');
  });
});
