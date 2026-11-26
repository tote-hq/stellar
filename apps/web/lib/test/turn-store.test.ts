import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Cart, Product } from '@changuito/mcp/types';

import type { Turn } from '../agent/loop.ts';
import { decodeTurn, encodeTurn } from '../agent/turn-store.ts';

// Built here rather than imported from the loop: `newTurnState` lives next to
// the Anthropic client, and this file has no reason to load one.
const newTurnState = (): Turn => ({ messages: [], cache: { products: new Map() } });

const money = (centavos: number) => ({ centavos, display: `$${(centavos / 100).toFixed(2)}` });

const product = (skuId: string, name: string): Product => ({
  skuId,
  productId: `p-${skuId}`,
  name,
  sellerId: 'ardiaprod1080',
  price: money(315_000),
  available: true,
});

const cart = (): Cart => ({
  retailer: 'dia',
  cartId: '932b86e283104c35901d98cc1d67b557',
  lines: [
    {
      index: 0,
      skuId: '1',
      name: 'Leche descremada',
      quantity: 2,
      sellerId: 'ardiaprod1080',
      unitPrice: money(315_000),
      lineTotal: money(630_000),
      available: true,
    },
  ],
  total: money(630_000),
  messages: [],
});

/**
 * The bug this whole file exists to prevent. `JSON.stringify` turns a Map into
 * `{}` without complaining, so a round trip that "worked" would hand back a
 * conversation whose product cache had quietly emptied — and the symptom would
 * be the renderer drawing nothing, nowhere near the cause.
 */
test('the product Map survives a JSON round trip', () => {
  const turn = newTurnState();
  turn.cache.products.set('1', product('1', 'Leche descremada'));
  turn.cache.products.set('2', product('2', 'Café DIA 250g'));

  const wire = JSON.parse(JSON.stringify(encodeTurn(turn))) as unknown;
  const back = decodeTurn(wire);

  assert.ok(back);
  assert.ok(back.cache.products instanceof Map);
  assert.equal(back.cache.products.size, 2);
  assert.equal(back.cache.products.get('2')?.name, 'Café DIA 250g');
});

test('messages, cart and handoff url survive a round trip', () => {
  const turn = newTurnState();
  turn.messages.push({ role: 'user', content: [{ type: 'text', text: 'Armá un desayuno' }] });
  turn.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Busco leche.' }] });
  turn.cache.cart = cart();
  turn.cache.handoffUrl = 'https://diaonline.supermercadosdia.com.ar/checkout';

  const back = decodeTurn(JSON.parse(JSON.stringify(encodeTurn(turn))) as unknown);

  assert.ok(back);
  assert.equal(back.messages.length, 2);
  assert.deepEqual(back.messages, turn.messages);
  assert.equal(back.cache.cart?.cartId, '932b86e283104c35901d98cc1d67b557');
  assert.equal(back.cache.cart?.lines[0]?.quantity, 2);
  assert.equal(back.cache.handoffUrl, 'https://diaonline.supermercadosdia.com.ar/checkout');
});

test('compare fields round-trip, a turn without them still decodes, and v stays 1', () => {
  const bare = decodeTurn(JSON.parse(JSON.stringify(encodeTurn(newTurnState()))) as unknown);
  assert.ok(bare);
  assert.equal(bare.cache.compareFor, undefined);
  assert.equal(bare.cache.compareResult, undefined);
  assert.equal(encodeTurn(newTurnState()).v, 1);

  const turn = newTurnState();
  turn.cache.compareFor = 'cart-1|0:1:2:630000:1';
  turn.cache.compareResult = {
    status: 'ok',
    cartId: 'cart-1',
    handoffUrl: 'https://dia.example/cart',
    matched: 1,
    lines: 1,
    rows: [],
    gap: { diaSubtotalCentavos: 100, cotoSubtotalCentavos: 80, gapCentavos: 20 },
  };
  const wire = encodeTurn(turn);
  assert.equal(wire.v, 1);
  const back = decodeTurn(JSON.parse(JSON.stringify(wire)) as unknown);
  assert.equal(back?.cache.compareFor, 'cart-1|0:1:2:630000:1');
  assert.equal(back?.cache.compareResult?.gap?.gapCentavos, 20);
  assert.equal(back?.cache.compareResult?.status, 'ok');
});

test('coto cache and searches round-trip, and an older turn still decodes', () => {
  const older = decodeTurn({ v: 1, messages: [], products: [] });
  assert.ok(older);
  assert.equal(older.cache.coto, undefined);
  assert.equal(older.cache.searches, undefined);

  const turn = newTurnState();
  turn.cache.coto = { c1: { id: 'c1', name: 'Yerba', shelfCentavos: 1000, available: true } };
  turn.cache.searches = [{ query: 'yerba', retailer: 'coto', available: 1 }];
  turn.cache.diaPairs = [{ cotoId: 'c1', diaSkuId: 'd1', diaCentavos: 1100, confidence: 'ean' }];
  turn.cache.cotoRealDia = { pairs: turn.cache.diaPairs, buyer: 'GABC' };
  const back = decodeTurn(JSON.parse(JSON.stringify(encodeTurn(turn))) as unknown);
  assert.equal(back?.cache.coto?.c1?.name, 'Yerba');
  assert.equal(back?.cache.diaPairs?.[0]?.diaSkuId, 'd1');
  assert.equal(back?.cache.cotoRealDia?.buyer, 'GABC');
  turn.cache.cotoPay = true;
  const withPay = decodeTurn(JSON.parse(JSON.stringify(encodeTurn(turn))) as unknown);
  assert.equal(withPay?.cache.cotoPay, true);
  assert.equal(older.cache.cotoPay, undefined);
  assert.equal(back?.cache.searches?.[0]?.available, 1);
  assert.equal(encodeTurn(turn).v, 1);

  turn.cache.compared = ['d1', 'd2'];
  const withCompared = decodeTurn(JSON.parse(JSON.stringify(encodeTurn(turn))) as unknown);
  assert.deepEqual(withCompared?.cache.compared, ['d1', 'd2']);
  assert.equal(older.cache.compared, undefined);
});

test('an empty conversation round trips to an empty one, not to undefined', () => {
  const back = decodeTurn(JSON.parse(JSON.stringify(encodeTurn(newTurnState()))) as unknown);

  assert.ok(back);
  assert.equal(back.messages.length, 0);
  assert.equal(back.cache.products.size, 0);
});

/**
 * A stored value outlives the code that wrote it — a deploy mid-conversation is
 * the ordinary case, not the edge one. Every one of these has to start a fresh
 * turn rather than throw, because a 500 here costs the user a message on a key
 * that was going to expire anyway.
 */
test('junk decodes to undefined instead of throwing', () => {
  for (const junk of [
    undefined,
    null,
    'not json',
    42,
    {},
    { v: 1 },
    { v: 2, messages: [], products: [] }, // a future version
    { v: 1, messages: [], products: {} }, // a Map that was stringified naively
    { v: 1, messages: 'nope', products: [] },
  ]) {
    assert.equal(decodeTurn(junk), undefined, `should have rejected: ${JSON.stringify(junk)}`);
  }
});
