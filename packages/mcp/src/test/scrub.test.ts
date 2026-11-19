import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import type { VtexOrderForm } from '../adapters/orderform.js';
import { scrubOrderForm } from '../checkout/scrub.js';

const REAL = {
  orderFormId: 'abc123',
  clientProfileData: {
    email: 'ana.perez@gmail.com',
    firstName: 'Ana',
    lastName: 'Pérez',
    document: '30123456',
    documentType: 'dni',
    phone: '+5491155551234',
    isCorporate: false,
  },
  shippingData: {
    address: {
      addressId: 'a-real-id',
      street: 'Av. Santa Fe',
      number: '2871',
      complement: '7º B',
      reference: 'portón verde',
      receiverName: 'Ana Pérez',
      postalCode: 'C1425',
      city: 'CABA',
      geoCoordinates: [-58.4, -34.6],
    },
    availableAddresses: [
      { addressId: 'other', street: 'Calle Falsa', number: '123', postalCode: '1425' },
    ],
    logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega estándar' }],
  },
  paymentData: {
    payments: [],
    availableAccounts: [{ accountId: 'tok_1', cardNumber: '************4242' }],
    availableTokens: [{ token: 'tok_abc' }],
  },
  items: [{ id: '1234', name: 'Leche', quantity: 1, sellingPrice: 150000 }],
  totalizers: [{ id: 'Items', name: 'Total items', value: 150000 }],
} as unknown as VtexOrderForm;

describe('scrubOrderForm', () => {
  it('leaves nothing personal behind', () => {
    const json = JSON.stringify(scrubOrderForm(REAL));
    for (const leak of [
      'ana.perez@gmail.com',
      'Ana',
      'Pérez',
      '30123456',
      '5491155551234',
      'Av. Santa Fe',
      '2871',
      '7º B',
      'portón verde',
      'a-real-id',
      'Calle Falsa',
      'tok_abc',
      '4242',
    ]) {
      assert.ok(!json.includes(leak), `scrubbed orderForm still contains ${leak}`);
    }
  });

  it('drops the cart id, so a fixture cannot be replayed against a live cart', () => {
    assert.equal((scrubOrderForm(REAL) as unknown as Record<string, unknown>).orderFormId, undefined);
  });

  it('empties stored cards and tokens rather than renaming them', () => {
    const out = scrubOrderForm(REAL) as unknown as Record<string, any>;
    assert.deepEqual(out.paymentData.availableAccounts, []);
    assert.deepEqual(out.paymentData.availableTokens, []);
  });
});

describe('RULE: a recording only ever writes a scrubbed orderForm', () => {
  it('record.ts has no path that writes a raw one', async () => {
    const src = await readFile(new URL('../../src/record.ts', import.meta.url), 'utf8');
    assert.ok(src.includes('writeFile'), 'expected record.ts to write files');

    // Comments talk about orderForms; only code can leak one. Every place the
    // code assigns to an `orderForm` property must go through the scrubber —
    // the type declaration in the Capture interface being the one exception.
    const assignments = src
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .filter((l) => /(^\s*|[{,(]\s*)orderForm\s*:/.test(l))
      // Declarations and type annotations are not values going anywhere.
      .filter((l) => !/\b(let|const|var|interface|type)\b/.test(l))
      .filter((l) => !/orderForm\??\s*:\s*VtexOrderForm/.test(l));

    assert.ok(assignments.length > 0, 'expected record.ts to build an orderForm field');
    for (const line of assignments) {
      assert.ok(
        line.includes('scrubOrderForm('),
        `record.ts assigns an unscrubbed orderForm: ${line.trim()}`,
      );
    }
  });
});
