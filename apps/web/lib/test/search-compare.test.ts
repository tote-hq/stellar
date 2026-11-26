import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogItem } from '@changuito/mcp/compare';
import type { Product } from '@changuito/mcp/types';

import { feeCentavosOf } from '../checkout/compare-fee.ts';
import type { UiEvent } from '../protocol.ts';
import { emptyCache } from '../agent/render-tools.ts';
import {
  beginChainSearch,
  beginDualSearch,
  chainChoiceOn,
  dualSearchOn,
  searchCompareNote,
  searchMode,
} from '../agent/search-compare.ts';

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
    assert.equal(dualSearchOn({ compareOn: true, cotoEnabled: true, retailer: 'dia', order: 'dia' }), false);
    assert.equal(dualSearchOn({ compareOn: true, cotoEnabled: true, retailer: 'dia', order: 'coto' }), false);
    assert.equal(chainChoiceOn({ compareOn: true, cotoEnabled: true, retailer: 'dia' }), true);
    assert.equal(searchMode({ compareOn: true, cotoEnabled: true, retailer: 'dia' }), 'both');
    assert.equal(searchMode({ compareOn: true, cotoEnabled: true, retailer: 'dia', order: 'dia' }), 'dia');
    assert.equal(searchMode({ compareOn: true, cotoEnabled: true, retailer: 'dia', order: 'coto' }), 'coto');
    assert.equal(searchMode({ compareOn: true, cotoEnabled: true, retailer: 'jumbo', order: 'coto' }), 'off');
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
      /\[search_compare: id=sc1 dia=1 coto=1 matched=1 gapCentavos=18500 pairDia=d1 pairCoto=c1 pickDia=d1 pickCoto=c1 match=same\]/,
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

  it('carries card fields and keeps a Día order off Coto', async () => {
    const product = dia(2000);
    product.imageUrl = 'https://img.test/leche.jpg';
    product.unitMultiplier = 1;
    product.measurementUnit = 'lt';
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const search = beginChainSearch({
      chain: 'dia',
      id: 'only-dia',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      searcher: {
        async search() {
          throw new Error('coto should not be queried');
        },
      },
    });
    await search.finish({ products: [product], failed: false });
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') {
      assert.fail('expected a finished día search');
    }
    assert.deepEqual(finished.chains, ['dia']);
    assert.equal(finished.coto.length, 0);
    assert.equal(finished.gapCentavos, undefined);
    assert.equal(finished.dia[0]?.brand, 'Serenisima');
    assert.equal(finished.dia[0]?.imageUrl, 'https://img.test/leche.jpg');
    assert.equal(finished.dia[0]?.unitMultiplier, 1);
    assert.equal(finished.dia[0]?.measurementUnit, 'lt');
    assert.equal(cache.searches?.some((row) => row.retailer === 'coto'), false);
  });

  it('queries Coto only and does not invent a Día row', async () => {
    const hit = coto(1500);
    hit.imageUrl = 'https://img.test/coto.jpg';
    let calls = 0;
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const search = beginChainSearch({
      chain: 'coto',
      id: 'only-coto',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      searcher: {
        async search() {
          calls += 1;
          return [hit];
        },
      },
    });
    await search.finish();
    assert.equal(calls, 1);
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') {
      assert.fail('expected a finished coto search');
    }
    assert.deepEqual(finished.chains, ['coto']);
    assert.equal(finished.dia.length, 0);
    assert.equal(finished.coto[0]?.brand, 'Serenisima');
    assert.equal(finished.coto[0]?.imageUrl, 'https://img.test/coto.jpg');
    assert.equal(finished.coto[0]?.unitMultiplier, undefined);
    assert.equal(cache.coto?.c1?.imageUrl, 'https://img.test/coto.jpg');
    assert.equal(cache.searches?.some((row) => row.retailer === 'dia'), false);
  });

  it('emits one cheapest item per chain and does not follow another id', async () => {
    // No argument on the search is a model pick. The card is the cheapest
    // hit of the type. The gap is those two picks when they are the same product.
    const dearDia: Product = { ...dia(9000, '222'), skuId: 'dear-dia', name: 'Leche cara 1 L' };
    const cheapDia: Product = { ...dia(1000, '111'), skuId: 'cheap-dia', name: 'Leche barata 1 L' };
    const dearCoto: CatalogItem = { ...coto(8000, '222'), id: 'dear-coto', name: 'Leche cara 1 L' };
    const cheapCoto: CatalogItem = { ...coto(500, '111'), id: 'cheap-coto', name: 'Leche barata 1 L' };
    const gone: CatalogItem = { ...coto(100, '333'), id: 'gone-coto', name: 'Leche agotada 1 L', available: false };
    const { events, cache, done } = run([dearCoto, cheapCoto, gone], [dearDia, cheapDia]);
    const note = await done;
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') {
      assert.fail('expected a finished search');
    }
    assert.equal(finished.dia.length, 1);
    assert.equal(finished.coto.length, 1);
    assert.equal(finished.dia[0]?.id, 'cheap-dia');
    assert.equal(finished.coto[0]?.id, 'cheap-coto');
    assert.equal(finished.gapCentavos, 500);
    assert.equal(finished.feeCentavos, feeCentavosOf(500));
    assert.match(note, /pickDia=cheap-dia/);
    assert.match(note, /pickCoto=cheap-coto/);
    assert.match(note, /pairDia=cheap-dia pairCoto=cheap-coto/);
    assert.match(note, /match=same/);
    assert.match(note, /cheap-dia · Leche barata 1 L/);
    assert.match(note, /cheap-coto · Leche barata 1 L/);
    assert.doesNotMatch(note, /Leche cara/);
    assert.doesNotMatch(note, /agotada/);
    assert.equal(cache.coto?.['cheap-coto']?.name, 'Leche barata 1 L');
    assert.equal(cache.coto?.['dear-coto']?.name, 'Leche cara 1 L');
    assert.equal(cache.coto?.['gone-coto']?.name, 'Leche agotada 1 L');
    assert.equal(cache.searches?.find((row) => row.retailer === 'dia')?.available, 2);
    assert.equal(cache.searches?.find((row) => row.retailer === 'coto')?.available, 2);
    assert.deepEqual(cache.compared, ['dear-dia', 'cheap-dia']);
  });

  it('records compared Día ids and drops a pet-food hit on a Día-only search', async () => {
    const pet: Product = {
      ...dia(1000, '779'),
      skuId: 'pet',
      name: 'Snack Tasty Bite Carne Pedigree',
      brand: 'Pedigree',
    };
    const milk: Product = { ...dia(2000), skuId: 'milk', name: 'Leche Protein 1 L' };
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const search = beginChainSearch({
      chain: 'dia',
      id: 'typed',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
    });
    const note = await search.finish({ products: [pet, milk], failed: false });
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') {
      assert.fail('expected a finished día search');
    }
    assert.deepEqual(finished.dia.map((item) => item.id), ['milk']);
    assert.match(note, /match=none/);
    assert.deepEqual(cache.compared, ['pet', 'milk']);
    assert.equal(cache.searches?.find((row) => row.retailer === 'dia')?.available, 1);
  });
});
