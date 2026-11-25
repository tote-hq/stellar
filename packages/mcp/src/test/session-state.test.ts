import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSessionState } from '../session.js';
import type { LocationContext } from '../types.js';

const ctx = (retailer: string, postalCode = '1425'): LocationContext => ({
  retailer,
  country: 'ARG',
  postalCode,
  sellers: [],
  salesChannel: '1',
  degraded: false,
});

describe('createSessionState', () => {
  it('gives each shopper their own location', () => {
    const ana = createSessionState();
    const beto = createSessionState();

    ana.setLocation(ctx('dia', '1425'));
    beto.setLocation(ctx('carrefour', '5000'));

    assert.equal(ana.getLocation()!.retailer, 'dia');
    assert.equal(ana.getLocation()!.postalCode, '1425');
    assert.equal(beto.getLocation()!.retailer, 'carrefour');
  });

  it('gives each shopper their own carts', () => {
    const ana = createSessionState();
    const beto = createSessionState();

    ana.setLocation(ctx('dia'));
    beto.setLocation(ctx('dia'));
    ana.rememberCart('dia', 'cart-ana');
    beto.rememberCart('dia', 'cart-beto');

    assert.equal(ana.snapshot().carts.dia, 'cart-ana');
    assert.equal(beto.snapshot().carts.dia, 'cart-beto');
  });

  it('still drops carts when the same shopper switches supermarket', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.rememberCart('dia', 'cart-1');
    s.setLocation(ctx('carrefour'));
    assert.deepEqual(s.snapshot().carts, {});
  });
});

/**
 * A serverless instance is not durable, and losing a cart id is silent: the
 * next `ensureCart` creates an empty cart and `get_cart_link` hands the user a
 * link to it. So a round trip through storage has to be lossless.
 */
describe('snapshot and restore', () => {
  it('survives a round trip through JSON, which is what storage is', () => {
    const before = createSessionState();
    before.setLocation({ ...ctx('dia'), regionId: 'v2.ABC', degraded: true, note: 'no regions' });
    before.rememberCart('dia', 'cart-9');

    const after = createSessionState();
    after.restore(JSON.parse(JSON.stringify(before.snapshot())));

    assert.deepEqual(after.snapshot(), before.snapshot());
    assert.equal(after.getLocation()!.regionId, 'v2.ABC');
    assert.equal(after.getLocation()!.degraded, true);
    assert.equal(after.snapshot().carts.dia, 'cart-9');
  });

  it('keeps order and coto lines across a JSON round trip, and drops them on a retailer change', async () => {
    const before = createSessionState();
    before.setLocation(ctx('dia'));
    before.rememberCart('dia', 'cart-9');
    assert.equal(before.chooseOrder('coto', { hasLines: false }), 'set');
    before.setCotoLines([{ id: 'c1', quantity: 2 }]);
    const id = before.cotoCartId();

    const after = createSessionState();
    after.restore(JSON.parse(JSON.stringify(before.snapshot())));
    assert.equal(after.getOrder(), 'coto');
    assert.deepEqual(after.cotoLines(), [{ id: 'c1', quantity: 2 }]);
    assert.equal(after.cotoCartId(), id);

    const copy = after.snapshot();
    copy.coto![0]!.quantity = 9;
    assert.equal(after.cotoLines()[0]!.quantity, 2);

    after.setLocation(ctx('jumbo'));
    assert.equal(after.getOrder(), undefined);
    assert.deepEqual(after.cotoLines(), []);
    assert.deepEqual(after.snapshot().carts, {});
  });

  it('refuses to leave a Coto basket with lines unless replace is set', () => {
    const s = createSessionState();
    s.chooseOrder('coto');
    s.setCotoLines([{ id: 'c1', quantity: 1 }]);
    assert.equal(s.chooseOrder('dia', { hasLines: true }), 'needs_replace');
    assert.equal(s.getOrder(), 'coto');
    assert.equal(s.cotoLines().length, 1);
    assert.equal(s.chooseOrder('dia', { replace: true, hasLines: true }), 'replaced');
    assert.equal(s.getOrder(), 'dia');
    assert.deepEqual(s.cotoLines(), []);
  });

  it('drops the Día cart id when replace leaves Día', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.rememberCart('dia', 'cart-1');
    s.chooseOrder('dia');
    assert.equal(s.chooseOrder('coto', { replace: true, hasLines: true }), 'replaced');
    assert.equal(s.snapshot().carts.dia, undefined);
    assert.match(s.snapshot().carts.coto ?? '', /^coto-/);
  });

  it('hands out a copy, so mutating a snapshot cannot reach back into the session', () => {
    const s = createSessionState();
    s.setLocation(ctx('dia'));
    s.rememberCart('dia', 'cart-1');

    const snap = s.snapshot();
    snap.carts.dia = 'tampered';

    assert.equal(s.snapshot().carts.dia, 'cart-1');
  });
});
