import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cotoRealJobBody } from '../checkout/sandbox.ts';

describe('coto real sandbox body', () => {
  it('sends the delivery address and no Día login or card', () => {
    const body = cotoRealJobBody(
      'a'.repeat(64),
      [{ name: 'Leche', quantity: 1, sku: 'sku-1' }],
      { postalCode: '1425', street: 'Calle', number: '10', city: 'CABA' },
    );
    assert.equal(body.mode, 'coto_real');
    assert.equal(body.delivery.street, 'Calle');
    const json = JSON.stringify(body);
    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('pan'), false);
    assert.equal(json.includes('shopper'), false);
    assert.equal(json.includes('card'), false);
  });
});
