import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { openFailureMessage } from '../checkout/failure.ts';
import { FUNNEL_EVENTS, lockFailureCode, refundFailureCode } from '../funnel.ts';

describe('beta funnel', () => {
  it('names exactly the seven beta events', () => {
    assert.deepEqual([...FUNNEL_EVENTS], ['login', 'faucet', 'cart_built', 'pay_open', 'settle', 'refund', 'failure']);
  });

  it('maps refund and lock failures to codes, never the sentence', () => {
    assert.equal(refundFailureCode({ mode: 'demo' }), 'demo');
    assert.equal(refundFailureCode({ payment: 'declined' }), 'declined');
    assert.equal(refundFailureCode({ error: 'Día pidió una verificación (reCAPTCHA) antes de cobrar' }), 'recaptcha');
    assert.equal(refundFailureCode({ payment: 'error' }), 'payment_error');
    assert.equal(refundFailureCode({ phase: 'checkout' }), 'phase_checkout');
    assert.equal(refundFailureCode({ phase: 'juan@example.com' }), 'refund');
    assert.equal(lockFailureCode(openFailureMessage(new Error('insufficient lamports 1, need 2'))), 'insufficient_sol');
    assert.equal(lockFailureCode(openFailureMessage(new Error('Blockhash not found'))), 'expired');
    assert.equal(lockFailureCode(openFailureMessage(new Error('boom'))), 'lock_failed');
  });
});
