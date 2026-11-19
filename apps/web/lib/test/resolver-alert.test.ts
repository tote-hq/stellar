import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  checkoutAlert,
  RESOLVER_FAILURES_BEFORE_ALERT,
  resolverLogLine,
  STUCK_AFTER_MS,
} from '../checkout/resolver-alert.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('resolver alert', () => {
  const now = 10_000_000_000;

  it('stays quiet for a healthy run', () => {
    assert.equal(checkoutAlert({ startedAt: now - 60_000 }, now), null);
    assert.equal(checkoutAlert({ closeFailures: RESOLVER_FAILURES_BEFORE_ALERT - 1, startedAt: now }, now), null);
    assert.equal(checkoutAlert({ closeFailures: 9, startedAt: 0, outcome: 'refunded' }, now), null);
  });

  it('flags repeated resolver failures and a run past the timeout', () => {
    assert.equal(
      checkoutAlert({ closeFailures: RESOLVER_FAILURES_BEFORE_ALERT, startedAt: now - STUCK_AFTER_MS - 1 }, now),
      'resolver_failed',
    );
    assert.equal(checkoutAlert({ startedAt: now - STUCK_AFTER_MS - 1 }, now), 'stuck');
  });

  it('logs a short order prefix and codes only, never the raw error', () => {
    const id = 'a'.repeat(64);
    const line = resolverLogLine('resolver_close_failed', id, 'tx_rejected', 2);
    assert.deepEqual(line, { event: 'resolver_close_failed', order: 'aaaaaaaa', code: 'tx_rejected', failures: 2 });
    assert.ok(!JSON.stringify(line).includes(id));

    const route = src('../../app/api/checkout/status/route.ts');
    assert.match(route, /resolverLogLine\('resolver_close_failed'/);
    assert.doesNotMatch(route, /console\.error\('\[checkout\/status\] close', err\)/);
  });
});
