import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { VtexOrderForm } from '../adapters/orderform.js';
import { classifyDeterministic } from '../checkout/classify/index.js';
import { emptyPageState } from '../checkout/pagestate.js';
import { planAction, satisfiesGoal } from '../checkout/states.js';
import type { Verdict } from '../checkout/types.js';

const v = (over: Partial<Verdict>): Verdict => ({
  state: 'cart',
  confidence: 1,
  layer: 'orderform',
  why: 'test',
  ...over,
});

const ctx = { goal: 'confirmation' as const, hasAddress: true };

describe('planAction — what the loop is willing to click', () => {
  it('leaves the cart by the checkout button', () => {
    const ps = emptyPageState({ buttons: ['Seguir comprando', 'Finalizar compra'] });
    const a = planAction(v({ state: 'cart' }), ps, ctx);
    assert.equal(a.kind, 'click');
    assert.equal(a.kind === 'click' && a.label, 'Finalizar compra');
  });

  it('NEVER clicks a button that adds an item, even when it matches', () => {
    const ps = emptyPageState({ buttons: ['Agregar y continuar'] });
    const a = planAction(v({ state: 'cart' }), ps, ctx);
    assert.equal(a.kind, 'none', 'a button that agrega is not a forward button');
  });

  it('stops rather than guessing when the cart has no checkout button', () => {
    const a = planAction(v({ state: 'cart' }), emptyPageState({ buttons: ['Vaciar carrito'] }), ctx);
    assert.equal(a.kind, 'none');
  });

  it('confirms an address the store is showing', () => {
    const ps = emptyPageState({ buttons: ['Editar', 'Confirmar dirección'] });
    const a = planAction(v({ state: 'address_confirm', modalId: 'address_confirm' }), ps, ctx);
    assert.equal(a.kind === 'click' && a.label, 'Confirmar dirección');
  });

  it('fills the address form when we hold an address', () => {
    assert.equal(planAction(v({ state: 'address' }), emptyPageState(), ctx).kind, 'fill_address');
    const refused = planAction(v({ state: 'address' }), emptyPageState(), { ...ctx, hasAddress: false });
    assert.equal(refused.kind, 'none');
    assert.match(refused.why, /none has been set/);
  });

  it('dismisses an interstitial with its registry action, not with the upsell button', () => {
    const ps = emptyPageState({
      dialogText: ['Te puede interesar'],
      buttons: ['Agregar a mi compra', 'No, gracias'],
    });
    const a = planAction(v({ state: 'interstitial', modalId: 'upsell' }), ps, ctx);
    assert.equal(a.kind === 'click' && a.label, 'No, gracias');

    const bare = emptyPageState({ dialogText: ['Te puede interesar'], buttons: ['Agregar'] });
    const stopped = planAction(v({ state: 'interstitial', modalId: 'upsell' }), bare, ctx);
    assert.equal(stopped.kind, 'none');
  });

  it('accepts a preselected delivery option but never picks a slot blind', () => {
    const withButton = planAction(
      v({ state: 'shipping_slot' }),
      emptyPageState({ buttons: ['Continuar'] }),
      ctx,
    );
    assert.equal(withButton.kind, 'click');
    const without = planAction(v({ state: 'shipping_slot' }), emptyPageState(), ctx);
    assert.equal(without.kind, 'none');
    assert.match(without.why, /cannot tell which/);
  });

  it('waits on a processing screen instead of clicking again', () => {
    const a = planAction(v({ state: 'processing' }), emptyPageState(), ctx);
    assert.equal(a.kind, 'wait');
    assert.ok(a.kind === 'wait' && a.ms > 0);
  });

  it('hands a changed cart back to the user — price and stock are their call', () => {
    const a = planAction(v({ state: 'cart_changed' }), emptyPageState({ buttons: ['Continuar'] }), ctx);
    assert.equal(a.kind, 'none', 'a forward button is present and still not clicked');
  });

  it('does not try to fill a profile a linked session should already have', () => {
    assert.equal(planAction(v({ state: 'profile' }), emptyPageState(), ctx).kind, 'none');
  });

  it('does not type a card or answer a bank challenge', () => {
    assert.equal(planAction(v({ state: 'payment_form' }), emptyPageState(), ctx).kind, 'none');
    assert.equal(planAction(v({ state: 'threeds' }), emptyPageState(), ctx).kind, 'none');
  });

  it('has no plan for a state it does not know', () => {
    for (const state of ['unknown', 'declined', 'session_expired'] as const) {
      assert.equal(planAction(v({ state }), emptyPageState(), ctx).kind, 'none', state);
    }
  });
});

describe('satisfiesGoal', () => {
  it('treats a placed order as satisfying any goal — there is nothing left to drive', () => {
    assert.equal(satisfiesGoal('payment_form', 'payment_form'), true);
    assert.equal(satisfiesGoal('cart', 'payment_form'), false);
    assert.equal(satisfiesGoal('confirmation', 'payment_form'), true);
    assert.equal(satisfiesGoal('confirmation', 'confirmation'), true);
  });
});

const ITEM = { id: '1', quantity: 1, seller: '1', price: 1000, name: 'Leche' };
const of = (over: Partial<VtexOrderForm> = {}): VtexOrderForm =>
  ({
    orderFormId: 'ABC',
    items: [ITEM],
    clientProfileData: { email: 'a@b.test', firstName: 'A', document: '12345678' },
    shippingData: {
      address: { street: 'Av Corrientes', number: '1234', postalCode: '1043' },
      logisticsInfo: [{ itemIndex: 0, selectedSla: 'Normal' }],
    },
    paymentData: { payments: [] },
    ...over,
  }) as VtexOrderForm;

describe('classifyDeterministic — how the layers compose', () => {
  it('an orderGroup beats everything, including an open dialog', () => {
    const ps = emptyPageState({ dialogText: ['Te puede interesar'], headings: ['Sumale algo'] });
    const out = classifyDeterministic({ pageState: ps, orderForm: of({ orderGroup: 'OG-1' }) });
    assert.equal(out?.state, 'confirmation');
    assert.equal(out?.layer, 'orderform');
  });

  it('an empty cart beats a modal too', () => {
    const ps = emptyPageState({ dialogText: ['newsletter'], headings: ['Suscribite'] });
    const out = classifyDeterministic({ pageState: ps, orderForm: of({ items: [] }) });
    assert.equal(out?.state, 'empty_cart');
  });
});
