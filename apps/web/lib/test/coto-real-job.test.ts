import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cotoRealJobBody } from '../checkout/sandbox.ts';

describe('coto real sandbox body', () => {
  it('sends the delivery address and no Día login or card', () => {
    const body = cotoRealJobBody(
      'a'.repeat(64),
      [{ name: 'Leche', quantity: 1, sku: 'sku-1' }],
      { fulfillment: 'home', city: 'CABA', delivery: { postalCode: '1425', street: 'Calle', number: '10', city: 'CABA' } },
    );
    assert.equal(body.mode, 'coto_real');
    assert.equal(body.delivery?.street, 'Calle');
    const json = JSON.stringify(body);
    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('pan'), false);
    assert.equal(json.includes('shopper'), false);
    assert.equal(json.includes('card'), false);
  });

  it('never carries a card in either fulfillment', () => {
    const sentinel = 'SENTINEL-CARD-VALUE';
    const home = cotoRealJobBody('a'.repeat(64), [{ name: 'Leche', quantity: 1, sku: 'sku-1' }], {
      fulfillment: 'home',
      city: 'CABA',
      delivery: { postalCode: '1425', street: 'Calle', number: '10', city: 'CABA' },
    });
    const pickup = cotoRealJobBody('b'.repeat(64), [{ name: 'Leche', quantity: 1, sku: 'sku-1' }], {
      fulfillment: 'pickup',
      city: 'CABA',
    });
    for (const body of [home, pickup]) {
      assert.equal('card' in body, false);
      const json = JSON.stringify(body);
      assert.equal(json.includes('card'), false);
      assert.equal(json.includes('pan'), false);
      assert.equal(json.includes(sentinel), false);
    }
    assert.equal(pickup.city, 'CABA');
    assert.equal(pickup.delivery, undefined);
    assert.equal(JSON.stringify(pickup).includes('street'), false);
  });
});
