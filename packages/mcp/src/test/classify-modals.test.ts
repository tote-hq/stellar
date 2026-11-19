import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actionFor, classifyModal, modalById } from '../checkout/classify/modals.js';
import { emptyPageState } from '../checkout/pagestate.js';

const ps = emptyPageState;

describe('the screens we expect Día to show', () => {
  it('recognises a cookie banner and knows which button accepts it', () => {
    const p = ps({
      dialogText: ['Usamos cookies para mejorar tu experiencia'],
      buttons: ['Aceptar todas', 'Configurar'],
    });
    const v = classifyModal(p);
    assert.equal(v?.modalId, 'cookie_banner');
    assert.equal(v?.state, 'interstitial');
    assert.equal(actionFor(modalById('cookie_banner')!, p), 'Aceptar todas');
  });

  it('recognises the address-confirmation dialog', () => {
    const p = ps({
      headings: ['¿Es esta tu dirección de entrega?'],
      buttons: ['Confirmar dirección', 'Editar'],
    });
    const v = classifyModal(p);
    assert.equal(v?.modalId, 'address_confirm');
    assert.equal(actionFor(modalById('address_confirm')!, p), 'Confirmar dirección');
  });

  it('recognises the delivery-slot picker', () => {
    const v = classifyModal(ps({ headings: ['Elegí el día y horario de entrega'], buttons: ['Continuar'] }));
    assert.equal(v?.state, 'shipping_slot');
  });

  it('recognises a 3DS challenge by its heading', () => {
    const pages = [
      ps({ headings: ['Ingresá el código de verificación'], fields: [{ label: 'Código', type: 'text', required: true, filled: false }] }),
      ps({ fields: [{ label: 'OTP', type: 'tel', required: true, filled: false }] }),
    ];
    for (const page of pages) {
      assert.equal(classifyModal(page)?.state, 'threeds');
    }
  });

  it('recognises a decline', () => {
    const v = classifyModal(ps({ errors: ['Tu tarjeta fue rechazada por el banco'] }));
    assert.equal(v?.state, 'declined');
  });

  it('recognises the order-placed screen', () => {
    const v = classifyModal(ps({ headings: ['¡Gracias por tu compra!'], title: 'Pedido confirmado' }));
    assert.equal(v?.state, 'confirmation');
  });

  it('recognises a mid-checkout stock change', () => {
    const v = classifyModal(ps({ errors: ['Leche Descremada 1L quedó sin stock'] }));
    assert.equal(v?.state, 'cart_changed');
  });

  it('recognises being signed out', () => {
    const pages = [
      ps({ headings: ['Tu sesión ha expirado'], buttons: ['Iniciar sesión'] }),
      ps({ fields: [{ label: 'Contraseña', type: 'password', required: true, filled: false }] }),
    ];
    for (const page of pages) {
      assert.equal(classifyModal(page)?.state, 'session_expired');
    }
  });
});

describe('upsells', () => {
  const upsell = ps({
    dialogText: ['¿Te puede interesar? Sumale estos productos a tu compra'],
    buttons: ['Agregar al carrito', 'No, gracias'],
  });

  it('picks the dismiss button and NOT the one that spends money', () => {
    assert.equal(classifyModal(upsell)?.modalId, 'upsell');
    assert.equal(actionFor(modalById('upsell')!, upsell), 'No, gracias');
    // "Te puede interesar" is a section heading on every product page.
    const notAModal = ps({ headings: ['Te puede interesar'], buttons: ['Agregar'] });
    assert.equal(classifyModal(notAModal)?.modalId, undefined);
  });
});

describe('the registry as a whole', () => {
  it('returns no action for states that are not dismissible', () => {
    assert.equal(modalById('declined')!.action, undefined);
    assert.equal(modalById('threeds')!.action, undefined);
  });
});
