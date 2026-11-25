import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Cart } from '@changuito/mcp/types';

import { autoCompare, compareSummary, type CompareFn, type CompareSource } from '../agent/auto-compare.ts';
import type { RenderCache } from '../agent/render-tools.ts';
import type { UiEvent } from '../protocol.ts';

const money = (centavos: number) => ({ centavos, display: `$${(centavos / 100).toFixed(2)}` });

function basket(retailer = 'dia'): Cart {
  return {
    retailer,
    cartId: 'cart-1',
    lines: [{
      index: 0,
      skuId: 'sku-1',
      name: 'Leche',
      quantity: 1,
      sellerId: '1',
      unitPrice: money(10_000),
      lineTotal: money(10_000),
      available: true,
    }],
    total: money(10_000),
    messages: [],
  };
}

function cacheFor(retailer = 'dia', linked = true): RenderCache {
  const cart = basket(retailer);
  return {
    products: new Map(),
    cart,
    ...(linked ? { handoffUrl: 'https://dia.example/cart?orderFormId=cart-1', handoffFor: cart.cartId } : {}),
  };
}

const finished: CompareSource = {
  status: 'ok',
  matched: 1,
  lines: 1,
  gap: { diaSubtotalCentavos: 10_000, cotoSubtotalCentavos: 8_000, gapCentavos: 2_000 },
  rows: [{
    skuId: 'sku-1',
    name: 'Leche',
    quantity: 1,
    diaLineCentavos: 10_000,
    confidence: 'ean',
    coto: {
      id: 'coto-1',
      name: 'Leche Coto',
      shelfCentavos: 8_000,
      lineCentavos: 8_000,
      available: true,
      url: 'https://www.coto.com.ar/product/leche',
    },
  }],
};

function spy(): { fn: CompareFn; calls: number } {
  const state = { calls: 0 };
  const fn: CompareFn = async (_lines, _postal, opts) => {
    state.calls += 1;
    assert.ok(opts?.signal);
    return finished;
  };
  return { fn, get calls() { return state.calls; } };
}

const base = {
  toolName: 'get_cart_link',
  postalCode: '1414',
};

describe('autoCompare', () => {
  it('does not call Coto when the flag is off, the cart is not Día, or the link is missing', async () => {
    const off = spy();
    const events: UiEvent[] = [];
    const note = await autoCompare({
      ...base,
      cache: cacheFor(),
      enabled: false,
      emit: (event) => events.push(event),
      compare: off.fn,
    });
    assert.equal(note, undefined);
    assert.equal(off.calls, 0);
    assert.equal(events.length, 0);

    const jumbo = spy();
    await autoCompare({
      ...base,
      cache: cacheFor('jumbo'),
      enabled: true,
      emit: () => {},
      compare: jumbo.fn,
    });
    assert.equal(jumbo.calls, 0);

    const unlinked = spy();
    await autoCompare({
      ...base,
      cache: cacheFor('dia', false),
      enabled: true,
      emit: () => {},
      compare: unlinked.fn,
    });
    assert.equal(unlinked.calls, 0);
  });

  it('compares a Día cart that has a link, then repeats the card without calling Coto', async () => {
    const compared = spy();
    const events: UiEvent[] = [];
    const cache = cacheFor();
    const note = await autoCompare({
      ...base,
      cache,
      enabled: true,
      emit: (event) => events.push(event),
      compare: compared.fn,
    });
    assert.equal(compared.calls, 1);
    assert.equal(events[0]?.t === 'compare' && events[0].status, 'pending');
    assert.equal(events[1]?.t === 'compare' && events[1].status, 'ok');
    assert.equal(note, '[compare: status=ok retailer=dia matched=1/1 gapCentavos=2000]');
    assert.equal(cache.compareResult && compareSummary(cache.compareResult), note);

    const again = await autoCompare({
      ...base,
      cache,
      enabled: true,
      emit: (event) => events.push(event),
      compare: compared.fn,
    });
    assert.equal(compared.calls, 1);
    assert.equal(again, note);
    const last = events.at(-1);
    assert.equal(last?.t === 'compare' && last.status, 'ok');
  });

  it('does not publish an empty card when the compare call throws on abort', async () => {
    const events: UiEvent[] = [];
    const cache = cacheFor();
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    await assert.rejects(
      () => autoCompare({
        ...base,
        cache,
        enabled: true,
        signal: AbortSignal.abort(),
        emit: (event) => events.push(event),
        compare: async () => {
          throw err;
        },
      }),
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.t === 'compare' && events[0].status, 'pending');
    assert.equal(cache.compareResult, undefined);
    assert.equal(cache.compareFor, undefined);
  });

  it('offers Coto pay only on a settled card with a match', async () => {
    const events: UiEvent[] = [];
    const cache = cacheFor();
    cache.dualCheckout = true;
    await autoCompare({
      ...base,
      cache,
      enabled: true,
      emit: (event) => events.push(event),
      compare: async () => finished,
    });
    const pending = events[0];
    const done = events[1];
    assert.equal(pending?.t === 'compare' && pending.status, 'pending');
    assert.equal(pending?.t === 'compare' && 'checkoutDemo' in pending, false);
    assert.equal(done?.t === 'compare' && done.status === 'ok' && done.checkoutDemo, true);
  });

  it('does not run on a Coto cart', async () => {
    const events: UiEvent[] = [];
    const note = await autoCompare({
      ...base,
      cache: cacheFor('coto'),
      enabled: true,
      emit: (event) => events.push(event),
      compare: async () => finished,
    });
    assert.equal(note, undefined);
    assert.equal(events.length, 0);
  });
});
