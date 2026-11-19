import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAmount } from '../wallet/evm.js';

describe('parseAmount', () => {
  it('reads human units at the token’s own precision', () => {
    assert.equal(parseAmount('20', 6), 20_000_000n, '20 USDT, not 20 wei');
    assert.equal(parseAmount('0.5', 18), 500_000_000_000_000_000n);
  });

  it('refuses zero and negative amounts', () => {
    assert.throws(() => parseAmount('0', 6), /greater than zero/);
    assert.throws(() => parseAmount('-1', 6), /greater than zero|underflow|invalid/i);
  });
});
