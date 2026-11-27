import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Cart, Product } from '@changuito/mcp/types';

import type { UiEvent } from '../protocol.ts';
import {
  autoRenderCart,
  cartLink,
  cartWriteNeedsChoice,
  emptyCache,
  foreignCartSku,
  rememberStructured,
  runRenderTool,
  searchedEmpty,
  shopperNamedRetailer,
  type RenderCache,
} from '../agent/render-tools.ts';

const money = (centavos: number) => ({ centavos, display: `$${(centavos / 100).toFixed(2)}` });

const CART_ID = '932b86e283104c35901d98cc1d67b557';
const LINK = `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=${CART_ID}#/cart`;

const product = (skuId: string, name: string): Product => ({
  skuId,
  productId: `p-${skuId}`,
  name,
  sellerId: 'ardiaprod1080',
  price: money(315_000),
  available: true,
});

function line(skuId: string, quantity: number, unit: number, index = 0) {
  return {
    index,
    skuId,
    name: `sku ${skuId}`,
    quantity,
    sellerId: 'ardiaprod1080',
    unitPrice: money(unit),
    lineTotal: money(unit * quantity),
    available: true,
  };
}

function cart(lines = [line('1', 2, 315_000)], cartId = CART_ID): Cart {
  return {
    retailer: 'dia',
    cartId,
    lines,
    total: money(lines.reduce((n, l) => n + l.lineTotal.centavos, 0)),
    messages: [],
  };
}

/** Collects what the turn would have streamed to the browser. */
function recorder() {
  const events: UiEvent[] = [];
  return { events, emit: (e: UiEvent) => void events.push(e) };
}

const carts = (events: UiEvent[]) => events.filter((e) => e.t === 'cart');

/** What the MCP tools hand back, in the order a turn sees them. */
const addToCart = (c: Cart) => ({ cart: c });
const getCartLink = (c: Cart, handoffUrl = LINK) => ({ cart: c, handoffUrl });

describe('the cart draws itself', () => {
  it('RULE: a changed basket is drawn without the model asking', () => {
    // The bug: add_to_cart returned no structured cart, so the cache went stale
    // on the one call that changed it, and the model answered a modification by
    // pointing at the card already on screen — old lines, old total, same link.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);
    assert.equal(carts(events).length, 1);

    // The modification. Nothing calls render_cart.
    const bigger = cart([line('1', 2, 315_000), line('2', 1, 120_000, 1)]);
    rememberStructured(cache, addToCart(bigger));
    assert.equal(autoRenderCart(cache, emit), true);

    const drawn = carts(events);
    assert.equal(drawn.length, 2);
    assert.equal(drawn[1]?.cart.lines.length, 2);
    assert.equal(drawn[1]?.cart.total.centavos, 750_000);
    // The link comes along, because a payment section without one is the thing
    // the shopper was being sent back up the page for.
    assert.equal(drawn[1]?.handoffUrl, LINK);
  });

  it('RULE: an unchanged basket is not redrawn, however often it is mentioned', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);

    // view_cart, then get_cart_link again, then the same cart a third time.
    for (const structured of [{ cart: cart() }, getCartLink(cart()), { cart: cart() }]) {
      rememberStructured(cache, structured);
      assert.equal(autoRenderCart(cache, emit), false);
    }
    assert.equal(carts(events).length, 1);
  });

  it('notices a change that leaves the total alone', () => {
    // One 3.150,00 swapped for another. The card is different; the number is not.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    autoRenderCart(cache, emit);

    rememberStructured(cache, addToCart(cart([line('9', 2, 315_000)])));
    assert.equal(autoRenderCart(cache, emit), true);
    assert.equal(carts(events).length, 2);
    assert.equal(carts(events)[1]?.cart.lines[0]?.skuId, '9');
  });

  it('RULE: draws nothing until there is a link that opens this basket', () => {
    // A card whose only actionable control is missing is the case CLAUDE.md §2
    // warns about. add_to_cart comes first and has no link to give.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, addToCart(cart()));
    assert.equal(autoRenderCart(cache, emit), false);
    assert.equal(cartLink(cache), undefined);

    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);
    assert.equal(carts(events).length, 1);
  });

  it('RULE: never carries one basket’s link onto another', () => {
    // The URL has a cart id in it. A link kept across a change of basket — a
    // different retailer, a cart the store replaced — opens the wrong one.
    const cache = emptyCache();
    const { events, emit } = recorder();

    rememberStructured(cache, getCartLink(cart()));
    autoRenderCart(cache, emit);

    rememberStructured(cache, addToCart(cart([line('1', 1, 400_000)], 'a-different-cart')));
    assert.equal(cartLink(cache), undefined);
    assert.equal(autoRenderCart(cache, emit), false);
    assert.equal(carts(events).length, 1);
  });

  it('draws nothing for an empty basket', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();
    rememberStructured(cache, getCartLink(cart([])));
    assert.equal(autoRenderCart(cache, emit), false);
    assert.equal(carts(events).length, 0);
  });

  it('render_cart still shows an unchanged basket, and is not then repeated', () => {
    // The tool survives for the one job left to it: bringing the basket back
    // after a question about it.
    const cache = emptyCache();
    const { events, emit } = recorder();
    rememberStructured(cache, getCartLink(cart()));
    autoRenderCart(cache, emit);

    const res = runRenderTool(cache, { id: 'u1', name: 'render_cart', input: {} }, emit);
    assert.equal(res.is_error, undefined);
    assert.equal(carts(events).length, 2);
    // And the automatic render does not immediately say it a third time.
    assert.equal(autoRenderCart(cache, emit), false);
  });

  it('render_cart refuses before there is a cart', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();
    const res = runRenderTool(cache, { id: 'u1', name: 'render_cart', input: {} }, emit);
    assert.equal(res.is_error, true);
    assert.equal(carts(events).length, 0);
  });
});

describe('product cards', () => {
  it('renders the SKUs the model picked, and says which it could not', () => {
    const cache: RenderCache = emptyCache();
    rememberStructured(cache, { products: [product('1', 'Leche'), product('2', 'Arroz')] });
    const { events, emit } = recorder();

    const res = runRenderTool(
      cache,
      { id: 'u1', name: 'render_products', input: { sku_ids: ['1', '404'], note: 'la más barata' } },
      emit,
    );

    const grid = events.filter((e) => e.t === 'products');
    assert.equal(grid.length, 1);
    assert.deepEqual(grid[0]?.items.map((p) => p.skuId), ['1']);
    assert.equal(grid[0]?.note, 'la más barata');
    assert.match(String(res.content), /Skipped unknown SKUs: 404/);
  });

  it('RULE: a second search renders its own new SKUs', () => {
    // The bug: the images only ever appeared for the first search, and a
    // shopper who asked for more got names in prose and had to ask for the
    // pictures. Nothing in the cache stops the second grid — the rule that
    // does it lives in the prompt and the tool description, and both are
    // checked in prompt.test.ts. This pins the half that is mechanical: the
    // SKUs of a later search are renderable the moment that search returns.
    const cache = emptyCache();
    rememberStructured(cache, { products: [product('1', 'Leche')] });
    const first = recorder();
    runRenderTool(cache, { id: 'u1', name: 'render_products', input: { sku_ids: ['1'] } }, first.emit);

    rememberStructured(cache, { products: [product('7', 'Leche con proteína')] });
    const second = recorder();
    const res = runRenderTool(cache, { id: 'u2', name: 'render_products', input: { sku_ids: ['7'] } }, second.emit);

    assert.equal(res.is_error, undefined);
    const grid = second.events.filter((e) => e.t === 'products');
    assert.deepEqual(grid[0]?.items.map((p) => p.skuId), ['7']);
  });

  it('refuses a grid of SKUs already on the search row', () => {
    const cache = emptyCache();
    rememberStructured(cache, { products: [product('1', 'Leche'), product('2', 'Arroz')] });
    cache.compared = ['1', '2'];
    const { events, emit } = recorder();
    const res = runRenderTool(cache, { id: 'u1', name: 'render_products', input: { sku_ids: ['1', '2'] } }, emit);
    assert.equal(res.is_error, true);
    assert.equal(events.length, 0);
    assert.match(String(res.content), /already on the search_compare row/);
  });

  it('draws only the SKUs that are not already compared', () => {
    const cache = emptyCache();
    rememberStructured(cache, { products: [product('1', 'Leche'), product('2', 'Arroz')] });
    cache.compared = ['1'];
    const { events, emit } = recorder();
    const res = runRenderTool(cache, { id: 'u1', name: 'render_products', input: { sku_ids: ['1', '2'] } }, emit);
    assert.equal(res.is_error, undefined);
    const grid = events.filter((e) => e.t === 'products');
    assert.deepEqual(grid[0]?.items.map((p) => p.skuId), ['2']);
  });

  it('RULE: refuses a SKU that never came from a search', () => {
    // An invented SKU is an invented price, above a button that spends money.
    const cache = emptyCache();
    const { events, emit } = recorder();
    const res = runRenderTool(cache, { id: 'u1', name: 'render_products', input: { sku_ids: ['nope'] } }, emit);
    assert.equal(res.is_error, true);
    assert.equal(events.length, 0);
  });

  it('marks the cart when the dual checkout flag is on for this hop', () => {
    const cache = emptyCache();
    cache.dualCheckout = true;
    const { events, emit } = recorder();
    rememberStructured(cache, getCartLink(cart()));
    assert.equal(autoRenderCart(cache, emit), true);
    const drawn = events.find((e) => e.t === 'cart');
    assert.equal(drawn?.t === 'cart' && drawn.dualCheckout, true);
  });

  it('never stamps dual checkout on a Coto cart', () => {
    const cache = emptyCache();
    cache.dualCheckout = true;
    cache.cotoPay = true;
    const basket = cart([line('c1', 1, 1000)]);
    basket.retailer = 'coto';
    basket.cartId = 'coto-1';
    rememberStructured(cache, { cart: basket });
    const { events, emit } = recorder();
    assert.equal(autoRenderCart(cache, emit), true);
    const drawn = events.find((e) => e.t === 'cart');
    assert.equal(drawn?.t === 'cart' && drawn.dualCheckout, undefined);

    cache.drawn = undefined;
    const explicit = recorder();
    runRenderTool(cache, { id: 'r1', name: 'render_cart', input: {} }, explicit.emit);
    const shown = explicit.events.find((e) => e.t === 'cart');
    assert.equal(shown?.t === 'cart' && shown.dualCheckout, undefined);
  });

  it('draws a Coto basket with no link and not orderable, and still hides a Día basket without a link', () => {
    const cache = emptyCache();
    const { events, emit } = recorder();
    const coto = cart([line('c1', 1, 1000)]);
    coto.retailer = 'coto';
    coto.cartId = 'coto-1';
    rememberStructured(cache, { cart: coto });
    assert.equal(autoRenderCart(cache, emit), true);
    const drawn = events.find((e) => e.t === 'cart');
    assert.equal(drawn?.t === 'cart' && drawn.handoffUrl, undefined);
    assert.equal(drawn?.t === 'cart' && drawn.orderable, false);

    cache.cotoPay = true;
    cache.drawn = undefined;
    assert.equal(autoRenderCart(cache, emit), true);
    const payable = events.filter((e) => e.t === 'cart').at(-1);
    assert.equal(payable?.t === 'cart' && payable.orderable, true);

    const zero = emptyCache();
    zero.cotoPay = true;
    const emptyTotal = cart([line('c1', 1, 0)]);
    emptyTotal.retailer = 'coto';
    emptyTotal.cartId = 'coto-0';
    emptyTotal.total = { centavos: 0, display: '$0' };
    rememberStructured(zero, { cart: emptyTotal });
    const zeroEvents = recorder();
    assert.equal(autoRenderCart(zero, zeroEvents.emit), true);
    const blocked = zeroEvents.events.find((e) => e.t === 'cart');
    assert.equal(blocked?.t === 'cart' && blocked.orderable, false);

    const rendered = recorder();
    const admitted = emptyCache();
    admitted.cotoPay = true;
    rememberStructured(admitted, { cart: coto });
    const explicit = runRenderTool(admitted, { id: 'r1', name: 'render_cart', input: {} }, rendered.emit);
    assert.equal(explicit.is_error, undefined);
    const shown = rendered.events.find((e) => e.t === 'cart');
    assert.equal(shown?.t === 'cart' && shown.orderable, true);

    const dia = emptyCache();
    const rec = recorder();
    rememberStructured(dia, addToCart(cart()));
    assert.equal(autoRenderCart(dia, rec.emit), false);
    assert.equal(rec.events.length, 0);
  });

  it('render_missing accepts only a searched query that returned nothing available', () => {
    const cache = emptyCache();
    cache.searches = [{ query: 'leche de almendras', retailer: 'coto', available: 0 }];
    const { events, emit } = recorder();
    const ok = runRenderTool(
      cache,
      { id: 'm1', name: 'render_missing', input: { query: 'Leche de almendras', retailer: 'coto' } },
      emit,
    );
    assert.equal(ok.is_error, undefined);
    assert.equal(events[0]?.t === 'missing' && events[0].item, 'Leche de almendras');
    const rejected = runRenderTool(
      cache,
      { id: 'm2', name: 'render_missing', input: { query: 'yerba', retailer: 'dia' } },
      emit,
    );
    assert.equal(rejected.is_error, true);
    assert.equal(searchedEmpty(cache, 'leche de almendras', 'coto'), true);
  });

  it('refuses a cart write before a choice and a sku from the other chain', () => {
    assert.equal(cartWriteNeedsChoice(true, undefined), true);
    assert.equal(cartWriteNeedsChoice(true, 'coto'), false);
    assert.equal(cartWriteNeedsChoice(false, undefined), false);
    const dia = new Set(['d1']);
    const coto = new Set(['c1']);
    assert.equal(foreignCartSku('dia', 'c1', dia, coto), true);
    assert.equal(foreignCartSku('coto', 'd1', dia, coto), true);
    assert.equal(foreignCartSku('dia', 'd1', dia, coto), false);
    assert.equal(foreignCartSku('coto', 'c1', dia, coto), false);
  });

  it('refuses choose_retailer unless the shopper or the question just before named the store', () => {
    assert.equal(shopperNamedRetailer('coto', 'el más barato', 'Acá están los precios.'), false);
    assert.equal(shopperNamedRetailer('coto', 'Quiero pedir en Coto.', ''), true);
    assert.equal(shopperNamedRetailer('dia', 'Quiero pedir en Coto.', ''), false);
    assert.equal(shopperNamedRetailer('coto', 'Quiero seguir en Coto.', ''), true);
    assert.equal(shopperNamedRetailer('dia', 'Quiero seguir en Coto.', ''), false);
    assert.equal(
      shopperNamedRetailer('dia', 'Armá el carrito de Día con lo que charlamos y mostrame el pedido listo para pagar.', ''),
      true,
    );
    assert.equal(
      shopperNamedRetailer('coto', 'Armá el carrito de Coto con lo que charlamos y mostrame el pedido listo para pagar.', ''),
      true,
    );
    assert.equal(
      shopperNamedRetailer('coto', 'Armá el carrito de Día con lo que charlamos y mostrame el pedido listo para pagar.', ''),
      false,
    );
    assert.equal(shopperNamedRetailer('coto', 'sí', '¿Confirmás Coto?'), true);
  });

  it('names Día only as a whole word', () => {
    assert.equal(shopperNamedRetailer('dia', 'media docena', ''), false);
    assert.equal(shopperNamedRetailer('dia', 'todos los días', ''), false);
    assert.equal(shopperNamedRetailer('dia', 'diario', ''), false);
    assert.equal(shopperNamedRetailer('dia', 'agregá media docena de huevos', ''), false);
    assert.equal(shopperNamedRetailer('dia', 'inmediato', ''), false);
    assert.equal(shopperNamedRetailer('dia', 'Día', ''), true);
    assert.equal(shopperNamedRetailer('dia', 'dia', ''), true);
    assert.equal(shopperNamedRetailer('dia', 'en Día.', ''), true);
  });
});
