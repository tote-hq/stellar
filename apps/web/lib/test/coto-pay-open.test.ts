import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { cotoPayOpen, openCotoOrder, restoreActiveChat, type OpenCotoRow } from '../checkout/coto-pay-open.ts';

const coto = { retailer: 'coto', cartId: 'coto-1' };

describe('cotoPayOpen', () => {
  it('returns the Coto cart and the live session id', () => {
    const opened = cotoPayOpen({ cart: coto, sessionId: 'live', storedSessionId: 'stored' });
    assert.deepEqual(opened, { cart: coto, sessionId: 'live' });
  });

  it('uses the stored session id when the live one is empty', () => {
    assert.deepEqual(cotoPayOpen({ cart: coto, sessionId: null, storedSessionId: 'stored' }), {
      cart: coto,
      sessionId: 'stored',
    });
    assert.deepEqual(cotoPayOpen({ cart: coto, sessionId: '', storedSessionId: 'stored' }), {
      cart: coto,
      sessionId: 'stored',
    });
  });

  it('returns null when both session ids are empty', () => {
    assert.equal(cotoPayOpen({ cart: coto, sessionId: null, storedSessionId: null }), null);
    assert.equal(cotoPayOpen({ cart: coto, sessionId: '', storedSessionId: '' }), null);
    assert.equal(cotoPayOpen({ cart: null, sessionId: 'live', storedSessionId: null }), null);
  });

  it('returns null for a Día cart', () => {
    assert.equal(
      cotoPayOpen({ cart: { retailer: 'dia', cartId: 'dia-1' }, sessionId: 'live', storedSessionId: null }),
      null,
    );
  });

  it('returns the cart object that was passed in', () => {
    const cardCart = { retailer: 'coto', cartId: 'on-the-card' };
    const other = { retailer: 'coto', cartId: 'somewhere-else' };
    const opened = cotoPayOpen({ cart: cardCart, sessionId: 'live', storedSessionId: null });
    assert.equal(opened?.cart, cardCart);
    assert.notEqual(opened?.cart, other);
  });
});

describe('openCotoOrder', () => {
  const buyer = 'GBUYER';

  function row(over: Partial<OpenCotoRow> & { orderId: string }): OpenCotoRow {
    return {
      buyer,
      checkoutKind: 'coto_real_v1',
      openSig: 'sig',
      jobId: 'job',
      createdAt: 1,
      fulfillment: 'home',
      ...over,
    };
  }

  it('returns the newest open shopping record and carries pickup', () => {
    const opened = openCotoOrder(
      [
        row({ orderId: 'older', createdAt: 1 }),
        row({ orderId: 'other-buyer', buyer: 'SOMEONE', createdAt: 9 }),
        row({ orderId: 'settled', outcome: 'settled', createdAt: 9 }),
        row({ orderId: 'refunded', outcome: 'refunded', createdAt: 9 }),
        row({ orderId: 'quoted', openSig: undefined, createdAt: 9 }),
        row({ orderId: 'jobless', jobId: 'none', createdAt: 9 }),
        row({ orderId: 'other-kind', checkoutKind: 'manual_fee_v1', createdAt: 9 }),
        row({ orderId: 'newest', createdAt: 2, fulfillment: 'pickup' }),
      ],
      buyer,
    );
    assert.deepEqual(opened, { orderId: 'newest', fulfillment: 'pickup' });
  });

  it('returns null when this buyer has no open order', () => {
    assert.equal(openCotoOrder([], buyer), null);
    assert.equal(openCotoOrder([row({ orderId: 'quoted', openSig: '' })], buyer), null);
    assert.equal(openCotoOrder([row({ orderId: 'home' })], 'SOMEONE'), null);
  });
});

describe('restoreActiveChat', () => {
  it('is true only for an empty idle pane with an active chat', () => {
    assert.equal(restoreActiveChat({ activeChatId: 'abc', blockCount: 0, pending: false }), true);
    assert.equal(restoreActiveChat({ activeChatId: null, blockCount: 0, pending: false }), false);
    assert.equal(restoreActiveChat({ activeChatId: '', blockCount: 0, pending: false }), false);
    assert.equal(restoreActiveChat({ activeChatId: 'abc', blockCount: 2, pending: false }), false);
    assert.equal(restoreActiveChat({ activeChatId: 'abc', blockCount: 0, pending: true }), false);
  });
});

describe('Chat Coto pay open', () => {
  it('opens the modal from the card basket and restores an empty pane', () => {
    const chat = readFileSync(new URL('../../components/Chat.tsx', import.meta.url), 'utf8');
    assert.match(chat, /openCoto\(liveBasket\)/);
    assert.doesNotMatch(chat, /if \(shop\?\.cart\?\.retailer === 'coto'\) setCotoModal/);
    const mountAt = chat.indexOf('{cotoModal ?');
    const modalAt = chat.indexOf('<CotoRealModal');
    assert.ok(mountAt !== -1 && modalAt > mountAt);
    assert.doesNotMatch(chat.slice(mountAt, modalAt), /currentSessionId\(\)/);
    const restoreAt = chat.indexOf('restoreActiveChat(');
    const openAt = chat.indexOf('openChat(', restoreAt);
    assert.ok(restoreAt !== -1 && openAt > restoreAt);
    assert.ok(openAt - restoreAt < 500);
  });
});
