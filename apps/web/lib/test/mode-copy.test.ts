import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NETWORK_IDS } from '../deployments.ts';
import {
  balanceCopy,
  circleBalanceCopy,
  modeCopy,
  modeCopyFor,
  modes,
  previewMasthead,
  previewMastheadFor,
  receiveCopy,
  trustlineCopy,
} from '../mode-copy.ts';

/** Same keys in both languages. Values are not compared. */
function assertSameKeys(a: unknown, b: unknown, path: string): void {
  if (typeof a === 'function' || typeof b === 'function') {
    assert.equal(typeof a, 'function', path);
    assert.equal(typeof b, 'function', path);
    return;
  }
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

describe('mode copy', () => {
  it('every key exists in both languages', () => {
    assertSameKeys(modes('es'), modes('en'), 'modes');
    for (const net of NETWORK_IDS) {
      assertSameKeys(modeCopy(net, 'es'), modeCopy(net, 'en'), net);
    }
    const modePairs = [
      ['preview', 'testnet'],
      ['preview', 'mainnet'],
      ['production', 'testnet'],
      ['production', 'mainnet'],
    ] as const;
    for (const [mode, net] of modePairs) {
      assertSameKeys(modeCopyFor(mode, net, 'es'), modeCopyFor(mode, net, 'en'), `${mode}:${net}`);
    }
    assertSameKeys(previewMasthead('es'), previewMasthead('en'), 'masthead');
    assertSameKeys(previewMastheadFor(null, 'es'), previewMastheadFor(null, 'en'), 'masthead:null');
    assertSameKeys(previewMastheadFor('testnet', 'es'), previewMastheadFor('testnet', 'en'), 'masthead:testnet');
    assertSameKeys(balanceCopy('es'), balanceCopy('en'), 'balance');
    assertSameKeys(trustlineCopy('es'), trustlineCopy('en'), 'trustline');
    assertSameKeys(receiveCopy('es'), receiveCopy('en'), 'receive');
    assertSameKeys(circleBalanceCopy('es'), circleBalanceCopy('en'), 'circle');
  });
});
