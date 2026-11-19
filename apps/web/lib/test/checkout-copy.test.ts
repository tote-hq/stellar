import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkoutCopy } from '../checkout-copy.ts';
import { NETWORK_IDS } from '../deployments.ts';

/** Same keys in both languages. Values are not compared. */
function assertSameKeys(a: unknown, b: unknown, path: string): void {
  if (Array.isArray(a) || Array.isArray(b)) {
    assert.ok(Array.isArray(a) && Array.isArray(b), path);
    assert.equal(b.length, a.length, path);
    for (let i = 0; i < a.length; i += 1) assertSameKeys(a[i], b[i], `${path}[${i}]`);
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    assert.deepEqual(bk, ak, path);
    for (const key of ak) {
      assertSameKeys(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
    }
    return;
  }
  assert.notEqual(a, undefined, path);
  assert.notEqual(b, undefined, path);
  assert.equal(typeof b, typeof a, path);
}

describe('checkout copy', () => {
  it('every key exists in both languages', () => {
    for (const net of NETWORK_IDS) {
      assertSameKeys(checkoutCopy(net, 'es'), checkoutCopy(net, 'en'), net);
    }
  });
});
