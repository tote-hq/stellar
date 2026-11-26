import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogItem } from '@changuito/mcp/compare';
import type { Product } from '@changuito/mcp/types';

import { feeCentavosOf } from '../checkout/compare-fee.ts';
import type { UiEvent } from '../protocol.ts';
import { emptyCache } from '../agent/render-tools.ts';
import { beginDualSearch, dualSearchOn, searchCompareNote } from '../agent/search-compare.ts';

function dia(centavos: number, ean = '7790001'): Product {
  return {
    skuId: 'd1',
    productId: 'p1',
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean,
    sellerId: '1',
    price: { centavos, display: '$0' },
    available: true,
  };
}

function coto(centavos: number, ean = '7790001'): CatalogItem {
  return {
    id: 'c1',
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean,
    shelfPrice: { centavos, display: '$0' },
    priceSource: 'store_200',
    available: true,
  };
}

function run(items: CatalogItem[], products: Product[], failed = false) {
  const events: UiEvent[] = [];
  const cache = emptyCache();
  let started = false;
  const search = beginDualSearch({
    id: 'sc1',
    query: 'leche',
    postalCode: '1425',
    cache,
    emit: (event) => {
      if (!started) started = true;
      events.push(event);
    },
    searcher: {
      async search() {
        return items;
      },
    },
  });
  return { events, cache, started, done: search.finish({ products, failed }) };
}

describe('dual search', () => {
  it('is on only for Día when compare and Coto search are both on', () => {
    assert.equal(dualSearchOn({ compareOn: true, cotoEnabled: true, retailer: 'dia' }), true);
    assert.equal(dualSearchOn({ compareOn: true, cotoEnabled: true, retailer: 'jumbo' }), false);
    assert.equal(dualSearchOn({ compareOn: false, cotoEnabled: true, retailer: 'dia' }), false);
    assert.equal(dualSearchOn({ compareOn: true, cotoEnabled: false, retailer: 'dia' }), false);
  });

  it('emits pending before the result and does not write a cart', async () => {
    const { events, cache, started, done } = run([coto(229000)], [dia(247500)]);
    assert.equal(started, true);
    assert.equal(events[0]?.t === 'search_compare' && events[0].status, 'pending');
    const note = await done;
    assert.equal(cache.cart, undefined);
    const finished = events[1];
    assert.equal(finished?.t === 'search_compare' && finished.status, 'ok');
    assert.match(
      note,
      /\[search_compare: id=sc1 dia=1 coto=1 matched=1 gapCentavos=18500 pairDia=d1 pairCoto=c1\]/,
    );
    assert.match(note, /c1 · Leche Protein 1 L/);
    if (finished?.t === 'search_compare' && finished.status === 'ok') {
      assert.equal(finished.feeCentavos, feeCentavosOf(18500));
      assert.equal(finished.coto[0]?.shelfCentavos, 229000);
    }
  });

  it('fees 20% of the gap when Coto is dearer too', async () => {
    const { events, done } = run([coto(300000)], [dia(247500)]);
    await done;
    const finished = events[1];
    assert.equal(finished?.t === 'search_compare' && finished.status === 'ok' && finished.gapCentavos, 52500);
    assert.equal(
      finished?.t === 'search_compare' && finished.status === 'ok' && finished.feeCentavos,
      feeCentavosOf(52500),
    );
  });

  it('emits no zero-price rows when Coto is empty, errors, or times out', async () => {
    const empty = run([], [dia(1000)]);
    await empty.done;
    const emptyEvent = empty.events[1];
    assert.equal(emptyEvent?.t === 'search_compare' && emptyEvent.status, 'coto_empty');
    assert.equal(emptyEvent?.t === 'search_compare' && emptyEvent.status !== 'pending' && emptyEvent.coto.length, 0);

    const errored = beginDualSearch({
      id: 'err',
      query: 'leche',
      cache: emptyCache(),
      emit: () => undefined,
      searcher: {
        async search() {
          throw new Error('upstream');
        },
      },
    });
    const cache = emptyCache();
    const events: UiEvent[] = [];
    const failed = beginDualSearch({
      id: 'err',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      searcher: {
        async search() {
          throw new Error('upstream');
        },
      },
    });
    await failed.finish({ products: [dia(1000)], failed: false });
    assert.equal(events[1]?.t === 'search_compare' && events[1].status, 'coto_error');
    assert.equal(events[1]?.t === 'search_compare' && events[1].status !== 'pending' && events[1].coto.length, 0);
    void errored;

    const slow = beginDualSearch({
      id: 'slow',
      query: 'leche',
      cache: emptyCache(),
      emit: (event) => events.push(event),
      timeoutMs: 20,
      searcher: {
        search: () => new Promise(() => undefined),
      },
    });
    const note = await slow.finish({ products: [dia(1000)], failed: false });
    assert.match(note, /gap=unknown/);
    assert.match(searchCompareNote({ id: 'x', dia: 1, coto: 0, matched: 0, hits: [] }), /gap=unknown/);
    assert.match(
      searchCompareNote({
        id: 'x',
        dia: 1,
        coto: 1,
        matched: 1,
        gapCentavos: 100,
        pair: { diaSkuId: 'd1', cotoId: 'c9' },
        hits: [],
      }),
      /pairDia=d1 pairCoto=c9/,
    );
  });

  it('does not choose a retailer', async () => {
    const { cache, done } = run([coto(1000)], [dia(2000)]);
    await done;
    assert.equal(cache.cart, undefined);
    assert.equal(dualSearchOn({ compareOn: true, cotoEnabled: true, retailer: 'dia' }), true);
  });
});
