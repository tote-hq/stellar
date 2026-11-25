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

  it('includes the ops card when the server has one', () => {
    const body = cotoRealJobBody('a'.repeat(64), [{ name: 'Leche', quantity: 1, sku: 'sku-1' }], {
      fulfillment: 'pickup',
      city: 'CABA',
      card: { pan: '0000000000000000', cvv: '123', exp_month: '01', exp_year: '30', holder: 'OPS', kind: 'debit' },
    });
    assert.equal(body.city, 'CABA');
    assert.equal(body.card?.pan, '0000000000000000');
    assert.equal(body.delivery, undefined);
    assert.equal(JSON.stringify(body).includes('street'), false);
  });
});
