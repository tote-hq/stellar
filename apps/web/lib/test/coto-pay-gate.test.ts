import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cotoPayGate, type CotoAdmission, type CotoPayCart } from '../checkout/coto-pay-gate.ts';

const cart: CotoPayCart = {
  lines: [{ available: true, quantity: 1 }],
  total: { centavos: 2982099 },
};

const base = {
  admission: 'allowed' as CotoAdmission,
  orderState: 'open',
  readOnly: false,
  dualCheckout: false,
  cart,
};

describe('cotoPayGate', () => {
  it('pays an admitted basket and names every other gate', () => {
    assert.equal(cotoPayGate(base), 'pay');
    assert.equal(cotoPayGate({ ...base, admission: 'pending' }), 'waiting');
    assert.equal(cotoPayGate({ ...base, admission: 'failed' }), 'fetch_failed');
    assert.equal(cotoPayGate({ ...base, admission: 'denied' }), 'not_admitted');
    assert.equal(cotoPayGate({ ...base, orderState: 'paid' }), 'paid');
    assert.equal(cotoPayGate({ ...base, readOnly: true }), 'read_only');
    assert.equal(cotoPayGate({ ...base, dualCheckout: true }), 'dual_checkout');
    assert.equal(cotoPayGate({ ...base, cart: { lines: [{ available: false, quantity: 1 }], total: { centavos: 10 } } }), 'no_total');
    assert.equal(cotoPayGate({ ...base, cart: { lines: [{ available: true, quantity: 1 }], total: { centavos: 0 } } }), 'no_total');
    assert.equal(cotoPayGate({ ...base, cart: null }), 'no_total');
  });

  it('keeps the precedence paid, read-only, comparison, admission, total', () => {
    assert.equal(
      cotoPayGate({
        admission: 'pending',
        orderState: 'paid',
        readOnly: true,
        dualCheckout: true,
        cart: null,
      }),
      'paid',
    );
    assert.equal(
      cotoPayGate({
        admission: 'failed',
        orderState: 'open',
        readOnly: true,
        dualCheckout: true,
        cart: null,
      }),
      'read_only',
    );
    assert.equal(
      cotoPayGate({
        admission: 'denied',
        orderState: 'open',
        readOnly: false,
        dualCheckout: true,
        cart,
      }),
      'dual_checkout',
    );
    assert.equal(
      cotoPayGate({
        admission: 'pending',
        orderState: 'open',
        readOnly: false,
        dualCheckout: false,
        cart: null,
      }),
      'waiting',
    );
  });
});
