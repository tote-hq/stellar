import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  applyCartAddReply,
  applyEvent,
  cartAdded,
  canRetry,
  dualCheckoutOn,
  endTurn,
  failTurn,
  initialState,
  omitErrorMessage,
  resetIds,
  retryUser,
  searchRowAt,
  sendUser,
  type ChatState,
} from '../chat-state.ts';
import { LOGIN_REQUIRED_MESSAGE } from '../login-constants.ts';
import type { UiEvent } from '../protocol.ts';

const run = (events: UiEvent[], from: ChatState = initialState) => events.reduce(applyEvent, from);

const money = (c: number) => ({ centavos: c, display: `$${(c / 100).toFixed(2)}` });
const product = (skuId: string) => ({
  skuId,
  productId: `p${skuId}`,
  name: `Producto ${skuId}`,
  sellerId: '1',
  price: money(1_000),
  available: true,
});
const cart = (id: string) => ({ retailer: 'dia', cartId: id, lines: [], total: money(0), messages: [] });

beforeEach(resetIds);

describe('applyEvent', () => {
  it('streams text into one block instead of one block per delta', () => {
    const s = run([
      { t: 'text', delta: 'Buscando ' },
      { t: 'text', delta: 'leche…' },
    ]);
    assert.equal(s.blocks.length, 1);
    assert.equal(s.blocks[0].kind === 'say' && s.blocks[0].text, 'Buscando leche…');
  });

  it('keeps text written after a grid below that grid', () => {
    // The ordering bug this file exists for: if the grid were appended at the
    // end of the turn, the sentence introducing it would read as its caption.
    const s = run([
      { t: 'text', delta: 'Encontré esto:' },
      { t: 'products', items: [product('1')] },
      { t: 'text', delta: 'La segunda conviene.' },
    ]);
    assert.deepEqual(s.blocks.map((b) => b.kind), ['say', 'products', 'say']);
    assert.equal(s.blocks[2].kind === 'say' && s.blocks[2].text, 'La segunda conviene.');
  });

  it('separates thinking from the reply', () => {
    const s = run([
      { t: 'thinking', delta: 'comparar por kilo' },
      { t: 'text', delta: 'La de 1L.' },
    ]);
    const b = s.blocks[0];
    assert.ok(b.kind === 'say' && b.thinking === 'comparar por kilo' && b.text === 'La de 1L.');
  });

  it('closes a tool run on the block that started it, not the open one', () => {
    const s = run([
      { t: 'tool_start', id: 'call_1', name: 'search_products' },
      { t: 'products', items: [product('1')] },
      { t: 'text', delta: 'listo' },
      { t: 'tool_end', id: 'call_1', ok: true, ms: 812 },
    ]);
    const first = s.blocks[0];
    assert.ok(first.kind === 'say' && first.tools[0].ok === true && first.tools[0].ms === 812);
    const before = run([{ t: 'text', delta: 'hola' }]);
    const after = applyEvent(before, { t: 'tool_end', id: 'ghost', ok: false, ms: 1 });
    assert.deepEqual(after.blocks, before.blocks);
  });

  it('tracks the newest cart for the pay button', () => {
    const s = run([
      { t: 'cart', cart: cart('old') },
      { t: 'cart', cart: cart('new'), handoffUrl: 'https://dia/checkout' },
    ]);
    assert.equal(s.cart?.cart.cartId, 'new');
    assert.equal(s.cart?.handoffUrl, 'https://dia/checkout');
  });

  it('draws one card when the same cart is rendered twice in a turn', () => {
    // What the user actually saw: a card with no link, then the same basket
    // again with one. It reads as two orders. React keys off the block id, so
    // a new id would animate a second card that looks like that duplicate.
    const s = run([
      { t: 'cart', cart: cart('c1') },
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
    ]);
    assert.deepEqual(s.blocks.map((b) => b.kind), ['cart']);
    assert.equal(s.blocks[0].kind === 'cart' && s.blocks[0].handoffUrl, 'https://dia/checkout');
    assert.equal(s.blocks[0].id, 'b1');

    resetIds();
    const kept = run([
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
      { t: 'cart', cart: cart('c1') },
    ]);
    assert.equal(kept.blocks[0].kind === 'cart' && kept.blocks[0].handoffUrl, 'https://dia/checkout');
    assert.equal(kept.cart?.handoffUrl, 'https://dia/checkout');

    resetIds();
    const other = run([
      { t: 'cart', cart: cart('old') },
      { t: 'cart', cart: cart('new') },
    ]);
    assert.deepEqual(other.blocks.map((b) => b.kind), ['cart', 'cart']);
  });

  it('keeps the cart from an earlier turn as a record of what it was then', () => {
    // Merging across turns would rewrite a card the user has already scrolled
    // past — the basket as it was three messages ago is part of the story.
    const first = run([{ t: 'cart', cart: cart('c1') }], sendUser(initialState, 'armá un desayuno'));
    const s = run([{ t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' }], sendUser(first, 'sumá café'));

    assert.deepEqual(s.blocks.map((b) => b.kind), ['user', 'cart', 'user', 'cart']);
    assert.equal(s.blocks[1].kind === 'cart' && s.blocks[1].handoffUrl, undefined);
    assert.equal(s.blocks[3].kind === 'cart' && s.blocks[3].handoffUrl, 'https://dia/checkout');
  });

  it('replaces the same cart when a card click adds a line', () => {
    resetIds();
    const shown = run([{ t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' }]);
    const id = shown.blocks[0].id;
    const next = {
      ...cart('c1'),
      lines: [
        {
          index: 0,
          skuId: 'd1',
          name: 'Leche',
          quantity: 1,
          sellerId: '1',
          unitPrice: money(1000),
          lineTotal: money(1000),
          available: true,
        },
      ],
      total: money(1000),
    };
    const added = cartAdded(shown, { t: 'cart', cart: next }, { carts: {} });
    assert.equal(added.blocks.length, 1);
    assert.equal(added.blocks[0].id, id);
    assert.equal(added.blocks[0].kind === 'cart' && added.blocks[0].handoffUrl, 'https://dia/checkout');
    assert.equal(added.cart?.cart.lines.length, 1);
    assert.deepEqual(added.snapshot, { carts: {} });

    resetIds();
    const fresh = cartAdded(initialState, { t: 'cart', cart: cart('c2'), handoffUrl: 'https://dia/new' }, undefined);
    assert.equal(fresh.blocks.length, 1);
    assert.equal(fresh.blocks[0].kind === 'cart' && fresh.blocks[0].cart.cartId, 'c2');
    assert.equal(fresh.cart?.cart.cartId, 'c2');
  });

  it('keeps a successful card add when the server drew no cart', () => {
    // A Día add whose link call failed returns 200 { ok: true, event: null }
    // after the line is already in the basket. Treating that as a failure
    // shows "could not add" and drops the new cart id, so a retry adds twice
    // and the next chat turn rebuilds an empty session.
    const held = { carts: { dia: 'old' } };
    const next = { carts: { dia: 'new' }, order: 'dia' as const };
    const event = { t: 'cart' as const, cart: cart('new'), handoffUrl: 'https://dia/checkout' };

    const drawn = applyCartAddReply(held, true, { ok: true, event, snapshot: next });
    assert.equal(drawn.result, 'added');
    assert.deepEqual(drawn.snapshot, next);
    const withCard = drawn.apply(initialState);
    assert.equal(withCard.blocks.length, 1);
    assert.equal(withCard.blocks[0].kind === 'cart' && withCard.blocks[0].cart.cartId, 'new');
    assert.deepEqual(withCard.snapshot, next);

    resetIds();
    const shown = run([{ t: 'text', delta: 'Listo.' }]);
    const quiet = applyCartAddReply(held, true, { ok: true, event: null, snapshot: next });
    assert.equal(quiet.result, 'added');
    assert.deepEqual(quiet.snapshot, next);
    const kept = quiet.apply(shown);
    assert.deepEqual(kept.blocks, shown.blocks);
    assert.equal(kept.cart, undefined);
    assert.deepEqual(kept.snapshot, next);

    const refused = applyCartAddReply(held, true, { ok: false, event, snapshot: next });
    assert.equal(refused.result, 'failed');
    assert.deepEqual(refused.snapshot, held);
    assert.equal(refused.apply(shown), shown);

    const http = applyCartAddReply(held, false, { ok: true, event: null, snapshot: next });
    assert.equal(http.result, 'failed');
    assert.deepEqual(http.snapshot, held);
    assert.equal(http.apply(shown), shown);
  });

  it('drops the get_cart_link trail row once this turn draws the cart', () => {
    // The row lingered under the card, closed as "0.0s" when the call was
    // under 50ms. The card is the resolution, so the row does not stay.
    const s = run([
      { t: 'tool_start', id: 'search', name: 'search_products' },
      { t: 'tool_end', id: 'search', ok: true, ms: 900 },
      { t: 'text', delta: 'Listo.' },
      { t: 'tool_start', id: 'link', name: 'get_cart_link' },
      { t: 'tool_end', id: 'link', ok: true, ms: 12 },
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
    ]);
    const say = s.blocks.find((b) => b.kind === 'say');
    assert.ok(say?.kind === 'say');
    assert.equal(say.text, 'Listo.');
    assert.deepEqual(
      say.tools.map((t) => t.name),
      ['search_products'],
    );
    assert.equal(s.blocks.some((b) => b.kind === 'cart'), true);

    const open = run([
      { t: 'tool_start', id: 'link', name: 'get_cart_link' },
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
    ]);
    assert.deepEqual(open.blocks.map((b) => b.kind), ['cart']);
    const after = applyEvent(open, { t: 'tool_end', id: 'link', ok: true, ms: 12 });
    assert.deepEqual(after.blocks.map((b) => b.kind), ['cart']);

    const failed = run([
      { t: 'tool_start', id: 'link', name: 'get_cart_link' },
      { t: 'tool_end', id: 'link', ok: false, ms: 40 },
      { t: 'cart', cart: cart('c1'), handoffUrl: 'https://dia/checkout' },
    ]);
    const failedSay = failed.blocks.find((b) => b.kind === 'say');
    assert.ok(failedSay?.kind === 'say');
    assert.equal(failedSay.tools.length, 1);
    assert.equal(failedSay.tools[0]?.name, 'get_cart_link');
    assert.equal(failedSay.tools[0]?.ok, false);
  });

  it('replaces a pending compare in this turn and keeps an earlier one', () => {
    const pending = {
      t: 'compare' as const,
      status: 'pending' as const,
      cartId: 'c1',
      handoffUrl: 'https://dia.example/cart',
    };
    const finished = {
      t: 'compare' as const,
      status: 'ok' as const,
      cartId: 'c1',
      handoffUrl: 'https://dia.example/cart',
      matched: 1,
      lines: 2,
      rows: [],
      gap: { diaSubtotalCentavos: 100, cotoSubtotalCentavos: 80, gapCentavos: 20 },
    };
    const s = run([pending, finished]);
    assert.equal(s.blocks.length, 1);
    assert.equal(s.blocks[0]?.kind, 'compare');
    assert.equal(s.blocks[0]?.kind === 'compare' && s.blocks[0].status, 'ok');
    assert.equal(s.blocks[0]?.kind === 'compare' && s.blocks[0].id, 'b1');
    assert.equal(s.blocks[0]?.kind === 'compare' && s.blocks[0].gap?.gapCentavos, 20);

    const first = run([finished], sendUser(initialState, 'armá un desayuno'));
    const next = run(
      [{ ...finished, status: 'degraded', gap: undefined }],
      sendUser(first, 'sumá café'),
    );
    assert.deepEqual(next.blocks.map((b) => b.kind), ['user', 'compare', 'user', 'compare']);
    assert.equal(next.blocks[1]?.kind === 'compare' && next.blocks[1].status, 'ok');
    assert.equal(next.blocks[3]?.kind === 'compare' && next.blocks[3].status, 'degraded');
  });

  it('done frees the composer and keeps the snapshot for the next turn', () => {
    const sent = sendUser(initialState, 'hola');
    assert.equal(sent.streaming, true);
    const s = applyEvent(sent, { t: 'done', stopReason: 'end_turn', snapshot: { location: '1414', carts: {} } as never });
    assert.equal(s.streaming, false);
    assert.deepEqual(s.snapshot, { location: '1414', carts: {} });
  });

  it('a recoverable error leaves the turn running; a fatal one ends it', () => {
    const sent = sendUser(initialState, 'hola');
    assert.equal(applyEvent(sent, { t: 'error', message: 'sin stock', recoverable: true }).streaming, true);
    assert.equal(applyEvent(sent, { t: 'error', message: 'se cayó', recoverable: false }).streaming, false);
  });
});

describe('endTurn', () => {
  it('frees a composer stranded by a dropped connection', () => {
    const s = endTurn(sendUser(initialState, 'hola'), 'Se cortó la conexión.');
    assert.equal(s.streaming, false);
    assert.equal(s.blocks.at(-1)?.kind, 'error');
    const done = applyEvent(sendUser(initialState, 'hola'), {
      t: 'done', stopReason: 'end_turn', snapshot: { location: undefined, carts: {} } as never,
    });
    assert.deepEqual(endTurn(done, 'x'), done);
  });

  it('drops the login-required line and leaves other errors in place', () => {
    const gated = endTurn(sendUser(initialState, 'asado para 6'), LOGIN_REQUIRED_MESSAGE);
    assert.equal(
      gated.blocks.some((b) => b.kind === 'error' && b.message.includes('Para seguir, iniciá sesión')),
      true,
    );
    const cleared = omitErrorMessage(gated, LOGIN_REQUIRED_MESSAGE);
    assert.equal(
      cleared.blocks.some((b) => b.kind === 'error' && /Para seguir, iniciá sesión/.test(b.message)),
      false,
    );
    assert.equal(omitErrorMessage(cleared, LOGIN_REQUIRED_MESSAGE), cleared);

    const withStock = endTurn(sendUser(cleared, 'milanesas'), 'sin stock');
    const still = omitErrorMessage(withStock, LOGIN_REQUIRED_MESSAGE);
    const errors = still.blocks.filter((b) => b.kind === 'error');
    assert.equal(errors.length, 1);
    if (errors[0]?.kind === 'error') assert.equal(errors[0].message, 'sin stock');
  });
});

// The message from the bug report: the supermarket and the postal code the
// agent had just asked for, typed once and never received.
const JUMBO = 'jumbo 1430';
const login = { reason: 'login' as const, message: 'Para seguir, iniciá sesión.' };
const dropped = { reason: 'network' as const, message: 'Se cortó la conexión.' };

describe('failTurn', () => {
  it('appends the notice instead once the agent has said something', () => {
    // Half an answer is on screen: the server has the message, so "no se
    // envió" would be a lie.
    const said = applyEvent(sendUser(initialState, JUMBO), { t: 'text', delta: 'Buscando…' });
    const s = failTurn(said, dropped);
    assert.deepEqual(s.blocks.map((b) => b.kind), ['user', 'say', 'error']);
    assert.equal(s.blocks[0].kind === 'user' && s.blocks[0].failed, undefined);
  });
});

describe('retryUser', () => {
  it('reuses the bubble instead of saying it twice', () => {
    const before = failTurn(sendUser(initialState, JUMBO), login);
    const s = retryUser(before, 'b1');
    assert.equal(s.streaming, true);
    assert.equal(s.blocks[0].kind === 'user' && s.blocks[0].failed, undefined);
    assert.equal(s.blocks.length, before.blocks.length);
    assert.equal(s.blocks[0].id, 'b1');
    assert.equal(s.blocks[0].kind === 'user' && s.blocks[0].text, JUMBO);
    assert.ok(!('failed' in s.blocks[0]));
  });
});

describe('canRetry', () => {
  it('offers the button on the newest failed message', () => {
    assert.equal(canRetry(failTurn(sendUser(initialState, JUMBO), login), 'b1'), true);
    resetIds();
    // Re-sending now would reach the server after a message that came later.
    const moved = sendUser(failTurn(sendUser(initialState, JUMBO), login), 'continuar');
    assert.equal(canRetry(endTurn(moved), 'b1'), false);
    resetIds();
    assert.equal(canRetry(retryUser(failTurn(sendUser(initialState, JUMBO), login), 'b1'), 'b1'), false);
    resetIds();
    assert.equal(canRetry(endTurn(sendUser(initialState, 'hola')), 'b1'), false);
  });
});

describe('turn progress', () => {
  const received: UiEvent = { t: 'status', stage: 'received' };

  it('records the stage without adding anything to the transcript', () => {
    const s = run([received, { t: 'status', stage: 'thinking', hop: 0 }], sendUser(initialState, JUMBO));
    assert.deepEqual(s.blocks.map((b) => b.kind), ['user']);
    assert.deepEqual(s.progress, { stage: 'thinking', hop: 0, writing: false });
    const fb = run(
      [{ t: 'status', stage: 'thinking', hop: 2 }, { t: 'status', stage: 'fallback' }],
      sendUser(initialState, JUMBO),
    );
    assert.deepEqual(fb.progress, { stage: 'fallback', hop: 2, writing: false });
  });

  it('notes when reply text starts, and forgets it at the next status', () => {
    const writing = run([received, { t: 'text', delta: 'Busco' }], sendUser(initialState, JUMBO));
    assert.equal(writing.progress?.writing, true);
    const next = applyEvent(writing, { t: 'status', stage: 'thinking', hop: 1 });
    assert.equal(next.progress?.writing, false);
  });

  it('is gone once the turn ends, however it ends', () => {
    const live = run([received], sendUser(initialState, JUMBO));
    const done = applyEvent(live, {
      t: 'done', stopReason: 'end_turn', snapshot: { location: undefined, carts: {} } as never,
    });
    assert.ok(!('progress' in done));
    assert.ok(!('progress' in endTurn(live)));
    assert.ok(!('progress' in applyEvent(live, { t: 'error', message: 'x', recoverable: false })));
    assert.ok(!('progress' in failTurn(live, dropped)));
    const stopped = endTurn(sendUser(initialState, JUMBO));
    assert.deepEqual(applyEvent(stopped, received), stopped);
    resetIds();
    const again = run([received], sendUser(initialState, JUMBO));
    const failed = failTurn(again, dropped);
    assert.ok(!('progress' in retryUser(failed, 'b1')));
  });
});

describe('failTurn after the server acknowledged the message', () => {
  it('says the answer was cut, not that the message never left', () => {
    // The QA shape: "Buscando…" for half a minute, then the stream died with
    // nothing on screen. The server had the message the whole time.
    const live = applyEvent(sendUser(initialState, JUMBO), { t: 'status', stage: 'received' });
    const s = failTurn(live, dropped);
    const b = s.blocks[0];
    assert.equal(b.kind === 'user' && b.failed?.reason, 'dropped');
    assert.equal(b.kind === 'user' && b.failed?.message, dropped.message);
    assert.equal(canRetry(s, 'b1'), true);

    resetIds();
    const net = failTurn(sendUser(initialState, JUMBO), dropped);
    assert.equal(net.streaming, false);
    assert.equal(net.blocks.length, 1);
    assert.equal(net.blocks[0].kind === 'user' && net.blocks[0].failed?.reason, 'network');

    resetIds();
    const gate = failTurn(sendUser(initialState, JUMBO), login);
    const g = gate.blocks[0];
    assert.equal(g.kind === 'user' && g.text, JUMBO);
    assert.deepEqual(g.kind === 'user' ? g.failed : undefined, login);
  });
});

describe('dual checkout flags on the transcript', () => {
  it('keeps the pay offer on a settled compare and not on a pending one', () => {
    const cartEvent = { t: 'cart' as const, cart: cart('c1'), handoffUrl: 'https://dia/checkout', dualCheckout: true as const };
    const pending = { t: 'compare' as const, status: 'pending' as const, cartId: 'c1', handoffUrl: 'https://dia/checkout' };
    const settled = {
      t: 'compare' as const,
      status: 'ok' as const,
      cartId: 'c1',
      handoffUrl: 'https://dia/checkout',
      matched: 1,
      lines: 1,
      rows: [],
      checkoutDemo: true as const,
    };
    const s = run([cartEvent, pending, settled]);
    const card = s.blocks.find((b) => b.kind === 'cart');
    const compare = s.blocks.find((b) => b.kind === 'compare');
    assert.equal(card?.kind === 'cart' && card.dualCheckout, true);
    assert.equal(compare?.kind === 'compare' && compare.checkoutDemo, true);
    assert.equal(dualCheckoutOn(s), true);
    const cotoCart = { ...cart('coto-1'), retailer: 'coto' };
    const afterCoto = run([
      cartEvent,
      settled,
      { t: 'cart', cart: cotoCart, dualCheckout: true },
    ]);
    const cotoCard = afterCoto.blocks.filter((b) => b.kind === 'cart').at(-1);
    assert.equal(cotoCard?.kind === 'cart' && cotoCard.dualCheckout, undefined);
    assert.equal(dualCheckoutOn(afterCoto), false);
    const waiting = run([cartEvent, pending]);
    const row = waiting.blocks.find((b) => b.kind === 'compare');
    assert.equal(row?.kind === 'compare' && row.checkoutDemo, undefined);
  });
});

describe('search compare and missing blocks', () => {
  it('replaces a pending search compare in place and keeps its id', () => {
    resetIds();
    const pending = {
      t: 'search_compare' as const,
      id: 'sc1',
      status: 'pending' as const,
      query: 'leche',
    };
    const done = {
      t: 'search_compare' as const,
      id: 'sc1',
      status: 'ok' as const,
      query: 'leche',
      dia: [{ id: 'd1', name: 'Leche', shelfCentavos: 1000, available: true }],
      coto: [{ id: 'c1', name: 'Leche', shelfCentavos: 800, available: true }],
      gapCentavos: 200,
      feeCentavos: 40,
    };
    const s = run([pending, done], sendUser(initialState, 'leche'));
    const cards = s.blocks.filter((b) => b.kind === 'search_compare');
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.kind === 'search_compare' && cards[0].status, 'ok');
    assert.equal(cards[0]?.kind === 'search_compare' && cards[0].id, 'b2');
    assert.equal(cards[0]?.kind === 'search_compare' && cards[0].gapCentavos, 200);
  });

  it('keeps card fields and the chains that were queried', () => {
    resetIds();
    const done = {
      t: 'search_compare' as const,
      id: 'sc2',
      status: 'ok' as const,
      query: 'huevos',
      chains: ['coto'] as ('dia' | 'coto')[],
      dia: [],
      coto: [
        {
          id: 'c1',
          name: 'Huevos',
          shelfCentavos: 800,
          available: true,
          brand: 'Coto',
          imageUrl: 'https://img.test/huevos.jpg',
        },
      ],
    };
    const s = run([done], sendUser(initialState, 'huevos'));
    const card = s.blocks.find((b) => b.kind === 'search_compare');
    assert.equal(card?.kind === 'search_compare' && card.chains?.[0], 'coto');
    assert.equal(card?.kind === 'search_compare' && card.coto[0]?.brand, 'Coto');
    assert.equal(card?.kind === 'search_compare' && card.coto[0]?.imageUrl, 'https://img.test/huevos.jpg');
    assert.equal(card?.kind === 'search_compare' && card.coto[0]?.unitMultiplier, undefined);
  });

  it('appends a missing block after the search card', () => {
    resetIds();
    const s = run(
      [
        { t: 'search_compare', id: 'sc1', status: 'coto_empty', query: 'tofu', dia: [], coto: [] },
        { t: 'missing', query: 'tofu', retailer: 'coto', item: 'tofu' },
      ],
      sendUser(initialState, 'tofu'),
    );
    const kinds = s.blocks.map((b) => b.kind);
    assert.deepEqual(kinds, ['user', 'search_compare', 'missing']);
  });
});

describe('searchRowAt', () => {
  it('returns the turn in order at the first index and nothing at the later ones', () => {
    resetIds();
    const s = run(
      [
        { t: 'search_compare', id: 'a', status: 'ok', query: 'arroz', dia: [], coto: [] },
        { t: 'search_compare', id: 'b', status: 'ok', query: 'huevos', dia: [], coto: [] },
      ],
      sendUser(initialState, 'lista'),
    );
    const first = s.blocks.findIndex((b) => b.kind === 'search_compare');
    const later = s.blocks.findIndex((b, i) => i > first && b.kind === 'search_compare');
    const row = searchRowAt(s.blocks, first);
    assert.deepEqual(
      row.map((b) => b.query),
      ['arroz', 'huevos'],
    );
    assert.deepEqual(searchRowAt(s.blocks, later), []);
  });

  it('does not reach into the previous turn', () => {
    resetIds();
    const firstTurn = run(
      [{ t: 'search_compare', id: 'a', status: 'ok', query: 'arroz', dia: [], coto: [] }],
      sendUser(initialState, 'uno'),
    );
    const second = run(
      [{ t: 'search_compare', id: 'b', status: 'ok', query: 'huevos', dia: [], coto: [] }],
      sendUser(firstTurn, 'dos'),
    );
    const earlier = second.blocks.findIndex((b) => b.kind === 'search_compare' && b.query === 'arroz');
    const current = second.blocks.findIndex((b) => b.kind === 'search_compare' && b.query === 'huevos');
    assert.deepEqual(
      searchRowAt(second.blocks, earlier).map((b) => b.query),
      ['arroz'],
    );
    assert.deepEqual(
      searchRowAt(second.blocks, current).map((b) => b.query),
      ['huevos'],
    );
  });
});
