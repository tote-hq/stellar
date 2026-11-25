import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPageState } from '../checkout/pagestate.js';
import {
  ADDRESS_FIELDS,
  BUTTONS,
  CARD_FIELDS,
  CREDIT_CARD_OPTION,
  looksLikeCardForm,
  matchesButton,
  matchesField,
  missingFields,
} from '../checkout/selectors.js';

const field = (label: string, type = 'text') => ({ label, type, required: false, filled: false });

/** The Día payment step, as the extractor sees it. */
const CARD_PAGE = emptyPageState({
  url: 'https://diaonline.supermercadosdia.com.ar/checkout/#/payment',
  fields: [
    field('Número de tarjeta'),
    field('Nombre como figura en la tarjeta'),
    field('Vencimiento (MM/AA)'),
    field('Código de seguridad'),
    field('DNI del titular'),
    field('Cuotas', 'select'),
  ],
  buttons: ['Tarjeta de crédito', 'Tarjeta de débito', 'Finalizar compra'],
});

const ADDRESS_PAGE = emptyPageState({
  fields: [
    field('Código postal'),
    field('Calle'),
    field('Número'),
    field('Piso / Depto'),
    field('Teléfono'),
  ],
  buttons: ['Continuar'],
});

describe('address selectors', () => {
  it('finds every required address field on the shipping form', () => {
    assert.deepEqual(missingFields(ADDRESS_FIELDS, ADDRESS_PAGE), []);
  });

  it('does not mistake the street field for the house number', () => {
    const ps = emptyPageState({ fields: [field('Dirección: número')] });
    assert.equal(matchesField(ADDRESS_FIELDS.street!, ps), false, "'número' excludes it");
    assert.equal(matchesField(ADDRESS_FIELDS.number!, ps), true);
  });
});

describe('card selectors', () => {
  it('finds every required card field on the Día payment form', () => {
    assert.deepEqual(missingFields(CARD_FIELDS, CARD_PAGE), []);
    assert.equal(looksLikeCardForm(CARD_PAGE), true);
  });

  it('never mistakes the postal code for the security code', () => {
    const ps = emptyPageState({ fields: [field('Código postal')] });
    assert.equal(matchesField(CARD_FIELDS.cvv!, ps), false);
  });
});

describe('the payment-method choice', () => {
  it('REFUSES débito and the local wallets — a prepaid BIN fails those', () => {
    for (const label of ['Tarjeta de débito', 'Efectivo', 'Transferencia', 'Mercado Pago', 'Cuenta DNI']) {
      const ps = emptyPageState({ buttons: [label] });
      assert.equal(matchesButton(CREDIT_CARD_OPTION, ps), undefined, label);
    }
  });
});

describe('buttons', () => {
  it('the pay button never resolves to cancel or back', () => {
    const ps = emptyPageState({ buttons: ['Cancelar pago', 'Volver'] });
    assert.equal(matchesButton(BUTTONS.pay!, ps), undefined);
  });

  it('the OTP submit never resolves to "reenviar código"', () => {
    const ps = emptyPageState({ buttons: ['Reenviar código'] });
    assert.equal(matchesButton(BUTTONS.submitOtp!, ps), undefined, 'that would restart the 3-minute race');
  });
});
