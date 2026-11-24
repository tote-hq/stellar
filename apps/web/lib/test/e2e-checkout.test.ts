import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { E2E_CHECKOUT_ADDRESS, e2eCheckoutHarness } from '../e2e-checkout.ts';

describe('e2e checkout harness', () => {
  it('is on only for a development server that opted in', () => {
    assert.equal(e2eCheckoutHarness({ NODE_ENV: 'development', NEXT_PUBLIC_E2E_CHECKOUT: '1' }), true);
    assert.equal(e2eCheckoutHarness({ NODE_ENV: 'production', NEXT_PUBLIC_E2E_CHECKOUT: '1' }), false);
    assert.equal(e2eCheckoutHarness({ NODE_ENV: 'development', NEXT_PUBLIC_E2E_CHECKOUT: '' }), false);
    assert.equal(e2eCheckoutHarness({ NODE_ENV: 'development' }), false);
  });

  it('uses a public fixture address and not a secret', () => {
    assert.match(E2E_CHECKOUT_ADDRESS, /^G[A-Z2-7]{55}$/);
    assert.equal(E2E_CHECKOUT_ADDRESS.startsWith('S'), false);
  });
});
