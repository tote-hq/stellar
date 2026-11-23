import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { probeAuthorized } from '../compare-probe.ts';

describe('probeAuthorized', () => {
  it('refuses when the token is unset', () => {
    assert.equal(probeAuthorized('Bearer secret', undefined), false);
    assert.equal(probeAuthorized('Bearer secret', ''), false);
  });

  it('refuses a wrong token', () => {
    assert.equal(probeAuthorized('Bearer wrong', 'secret'), false);
    assert.equal(probeAuthorized('Bearer secret', 'other'), false);
  });

  it('accepts the matching bearer', () => {
    assert.equal(probeAuthorized('Bearer secret', 'secret'), true);
  });

  it('does not throw when the header and the token differ in length', () => {
    assert.equal(probeAuthorized('Bearer x', 'secret'), false);
    assert.equal(probeAuthorized('Bearer secret-and-more', 'secret'), false);
    assert.equal(probeAuthorized(null, 'secret'), false);
  });
});
