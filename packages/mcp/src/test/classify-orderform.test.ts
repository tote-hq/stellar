import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VtexOrderForm } from '../adapters/orderform.js';
import { classifyOrderForm } from '../checkout/classify/orderform.js';

/**
 * Layer 1 is pure, so the entire main path of the checkout is verifiable here
 * with no browser, no network and no store. These orderForms are shaped the way
 * VTEX actually returns them: sections exist before they are filled in.
 */

const ITEM = { id: '272382', name: 'Leche', quantity: 2, seller: 'ardiaprod1080', sellingPrice: 234_000, availability: 'available' };
const PROFILE = { email: 'me@example.com', firstName: 'Ana', document: '30123456', documentType: 'dni' };
const ADDRESS = { street: 'Av. Corrientes', number: '1234', postalCode: '1043', city: 'CABA' };

const stage = {
  empty: (): VtexOrderForm => ({ orderFormId: 'of1', items: [] }),
  anonymous: (): VtexOrderForm => ({ orderFormId: 'of1', items: [ITEM], clientProfileData: null }),
  needsAddress: (): VtexOrderForm => ({
    orderFormId: 'of1', items: [ITEM], clientProfileData: PROFILE,
    shippingData: { address: null, logisticsInfo: [] },
  }),
  needsSlot: (): VtexOrderForm => ({
    orderFormId: 'of1', items: [ITEM], clientProfileData: PROFILE,
    shippingData: { address: ADDRESS, logisticsInfo: [{ itemIndex: 0, selectedSla: null, slas: [{ id: 'Entrega estándar' }] }] },
  }),
  needsPayment: (): VtexOrderForm => ({
    orderFormId: 'of1', items: [ITEM], clientProfileData: PROFILE,
    shippingData: { address: ADDRESS, logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega estándar' }] },
    paymentData: { payments: [] },
  }),
  ready: (): VtexOrderForm => ({
    ...stage.needsPayment(),
    paymentData: { payments: [{ paymentSystem: '2', value: 618_000 }] },
  }),
  placed: (): VtexOrderForm => ({ ...stage.ready(), orderGroup: '1509876543210' }),
};

describe('the happy path, one stage at a time', () => {
  it('an empty cart is not a checkout', () => {
    assert.equal(classifyOrderForm(stage.empty())?.state, 'empty_cart');
  });

  it('no email means not signed in', () => {
    const v = classifyOrderForm(stage.anonymous());
    assert.equal(v?.state, 'profile');
    assert.match(v!.why, /not signed in/);
  });

  it('a null address means the address step', () => {
    assert.equal(classifyOrderForm(stage.needsAddress())?.state, 'address');
  });

  it('an address with no selectedSla means the slot picker', () => {
    const v = classifyOrderForm(stage.needsSlot());
    assert.equal(v?.state, 'shipping_slot');
    assert.match(v!.why, /1 of 1 item group/);
  });

  it('no payments attached means the card form', () => {
    assert.equal(classifyOrderForm(stage.needsPayment())?.state, 'payment_form');
  });

  it('an orderGroup is the one unambiguous success signal', () => {
    const v = classifyOrderForm(stage.placed());
    assert.equal(v?.state, 'confirmation');
    assert.match(v!.why, /1509876543210/);
  });
});

describe('what this layer refuses to answer', () => {
  it('returns nothing without an orderForm, rather than guessing', () => {
    assert.equal(classifyOrderForm(undefined), undefined);
  });

  it('calls it processing on the payment route with everything attached', () => {
    const v = classifyOrderForm(stage.ready(), 'https://dia/checkout/#/payment');
    assert.equal(v?.state, 'processing');
  });
});
