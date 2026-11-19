import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readOrderForm } from '../order-check.ts';

/**
 * The bodies here are trimmed copies of what
 * `diaonline.supermercadosdia.com.ar/api/checkout/pub/orderForm/{id}` actually
 * returned on 2026-09-25, for a cart created and then given a profile through
 * the public API. `loggedIn: false` in both is not a typo — it describes the
 * requester, and the requester is us, with no cookies.
 */
const ID = '438358eb7d7348ec94a3f0c50b4ce228';

const anonymous = {
  orderFormId: ID,
  loggedIn: false,
  canEditData: true,
  userProfileId: null,
  userType: null,
  clientProfileData: null,
  items: [{ id: '1' }, { id: '2' }],
  value: 615000,
};

const identified = {
  ...anonymous,
  clientProfileData: {
    email: 'someone@example.com',
    firstName: 'Ana',
    document: '30123456',
    documentType: 'dni',
  },
};

/**
 * The same cart once a delivery has been picked, which is the state the
 * checkout now waits for before it quotes anything.
 *
 * `value` is 630000 against an Items totalizer of 615000: the difference is
 * the $150,00 envío, and the whole point of reading this document is that the
 * two numbers are not the same. `payableTotal` prefers `value`.
 */
const slotted = {
  ...identified,
  totalizers: [
    { id: 'Items', name: 'Total de los produtos', value: 615000 },
    { id: 'Shipping', name: 'Total do frete', value: 15000 },
  ],
  value: 630000,
  shippingData: {
    address: { street: 'Av. Siempreviva', number: '742', postalCode: 'C1425' },
    logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega Programada' }],
  },
  paymentData: { payments: [] },
};

/** Placed. `orderGroup` is the one unambiguous success signal in the document. */
const placed = { ...slotted, orderGroup: '1664787669574', items: [], value: 0 };

function stub(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

const probe = { retailer: 'dia', orderFormId: ID, itemsAtHandoff: 2 };

describe('reading a cart from outside it', () => {
  it('says nobody is attached to a fresh cart', async () => {
    const state = await readOrderForm(probe, stub(anonymous));
    assert.equal(state?.identified, false);
    assert.equal(state?.items, 2);
    assert.equal(state?.value, 615000);
    assert.equal(state?.state, 'profile');
  });

  it('RULE: a profile shell is not a signed-in shopper', async () => {
    const shell = { ...anonymous, clientProfileData: { email: '', firstName: null } };
    assert.equal((await readOrderForm(probe, stub(shell)))?.identified, false);
  });

  it('waits for the delivery, then reports the total with the envío in it', async () => {
    const before = await readOrderForm(probe, stub(identified));
    assert.equal(before?.identified, true);
    assert.equal(before?.slotChosen, false);
    assert.equal(before?.state, 'address');

    const after = await readOrderForm(probe, stub(slotted));
    assert.equal(after?.slotChosen, true);
    assert.equal(after?.payable, 630000);
    assert.deepEqual(after?.breakdown, [
      { id: 'Items', name: 'Total de los produtos', centavos: 615000 },
      { id: 'Shipping', name: 'Total do frete', centavos: 15000 },
    ]);
  });

  it('RULE: a delivery is chosen only when every group has a slot', async () => {
    const half = {
      ...slotted,
      shippingData: {
        ...slotted.shippingData,
        logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega Programada' }, { itemIndex: 1, selectedSla: null }],
      },
    };
    const state = await readOrderForm(probe, stub(half));
    assert.equal(state?.slotChosen, false);
    assert.equal(state?.state, 'shipping_slot');

    const none = { ...slotted, shippingData: { ...slotted.shippingData, logisticsInfo: [] } };
    assert.equal((await readOrderForm(probe, stub(none)))?.slotChosen, false);
  });

  it('carries the order id once the order exists', async () => {
    const state = await readOrderForm(probe, stub(placed));
    assert.equal(state?.orderGroup, '1664787669574');
    assert.equal(state?.state, 'confirmation');
    assert.equal(state?.looksPaid, true);
  });

  it('RULE: the profile and the address never come back', async () => {
    const profile = JSON.stringify(await readOrderForm(probe, stub(identified)));
    for (const secret of ['someone@example.com', 'Ana', '30123456', 'dni']) {
      assert.equal(profile.includes(secret), false, secret);
    }
    const state = await readOrderForm(probe, stub(slotted));
    const serialised = JSON.stringify(state);
    for (const secret of ['someone@example.com', 'Ana', '30123456', 'Siempreviva', '742', 'C1425']) {
      assert.equal(serialised.includes(secret), false, secret);
    }
    assert.equal(serialised.includes('selectedSla'), false);
    assert.equal(serialised.includes('confidence'), false);
    assert.equal(serialised.includes('layer'), false);
    assert.deepEqual(
      Object.keys(state!).sort(),
      ['breakdown', 'identified', 'items', 'looksPaid', 'orderGroup', 'payable', 'slotChosen', 'state', 'value'],
    );
  });

  it('RULE: missing lines look paid only when a real cart was emptied', async () => {
    const paid = { ...identified, items: [], value: 0 };
    assert.equal((await readOrderForm(probe, stub(paid)))?.looksPaid, true);
    assert.equal((await readOrderForm(probe, stub(identified)))?.looksPaid, false);
    const fromEmpty = await readOrderForm({ ...probe, itemsAtHandoff: 0 }, stub(paid));
    assert.equal(fromEmpty?.looksPaid, false);
    const neverExisted = { ...anonymous, items: [], value: 0 };
    const state = await readOrderForm(probe, stub(neverExisted));
    assert.equal(state?.identified, false);
    assert.equal(state?.looksPaid, false);
  });

  it('returns null for a dead store and for the wrong store', async () => {
    const dead = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    assert.equal(await readOrderForm(probe, dead), null);
    assert.equal(await readOrderForm(probe, stub({}, 404)), null);
    assert.equal(await readOrderForm({ ...probe, retailer: 'coto' }, stub(anonymous)), null);
  });
});
