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
  dualCheckoutStamp,
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

describe('ranked search', () => {
  it('stamps dual checkout only while the order is unset', () => {
    assert.equal(dualCheckoutStamp({ demoOn: true, cotoEnabled: true }), true);
    assert.equal(dualCheckoutStamp({ demoOn: true, cotoEnabled: true, order: 'coto' }), false);
    assert.equal(dualCheckoutStamp({ demoOn: true, cotoEnabled: true, order: 'dia' }), false);
    assert.equal(dualCheckoutStamp({ demoOn: false, cotoEnabled: true }), false);
    assert.equal(dualCheckoutStamp({ demoOn: true, cotoEnabled: false }), false);
  });

  it('fees the gap between the best-tier picks, not the cheapest napkins', async () => {
    const paper = (side: 'dia' | 'coto', centavos: number): Product | CatalogItem =>
      side === 'dia'
        ? {
            ...dia(centavos, '7791111'),
            skuId: 'dia-paper',
            name: 'Papel Higienico Campanita Soft 4 u',
          }
        : {
            ...coto(centavos, '7791111'),
            id: 'coto-paper',
            name: 'Papel Higienico Campanita Soft 4 u',
          };
    const napkinsDia: Product = {
      ...dia(100, '7799999'),
      skuId: 'dia-napkins',
      name: 'Servilletas Campanita Soft',
    };
    const napkinsCoto: CatalogItem = {
      ...coto(50, '7799999'),
      id: 'coto-napkins',
      name: 'Servilletas Campanita Soft',
    };
    const events: UiEvent[] = [];
    const search = beginDualSearch({
      id: 'tier',
      query: 'papel higienico campanita soft',
      cache: emptyCache(),
      emit: (event) => events.push(event),
      searcher: { async search() { return [napkinsCoto, paper('coto', 4000) as CatalogItem]; } },
    });
    await search.finish({ products: [napkinsDia, paper('dia', 5000) as Product], failed: false });
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') assert.fail('expected a card');
    assert.equal(finished.dia[0]?.id, 'dia-paper');
    assert.equal(finished.coto[0]?.id, 'coto-paper');
    assert.equal(finished.gapCentavos, 1000);
    assert.equal(finished.feeCentavos, feeCentavosOf(1000));
  });

  it('lists several ranked Coto hits and puts unseen ids first', async () => {
    const hits = [1, 2, 3, 4, 5].map((n) => ({
      ...coto(1000 + n),
      id: `c${n}`,
      name: `Leche ${n}`,
    }));
    const limits: number[] = [];
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const first = beginChainSearch({
      chain: 'coto',
      id: 'many',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      searcher: {
        async search(_query, opts) {
          limits.push(opts?.limit ?? 0);
          return hits;
        },
      },
    });
    const note = await first.finish();
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') assert.fail('expected a card');
    assert.ok(finished.coto.length > 1);
    assert.equal(finished.coto.length, 5);
    assert.match(note, /coto=5/);
    assert.deepEqual(limits, [24]);
    assert.deepEqual(
      finished.coto.map((item) => item.id),
      ['c1', 'c2', 'c3', 'c4', 'c5'],
    );

    cache.shown = finished.coto.map((item) => item.id);
    const againEvents: UiEvent[] = [];
    const extra = { ...coto(50), id: 'c-new', name: 'Leche nueva' };
    const second = beginChainSearch({
      chain: 'coto',
      id: 'more',
      query: 'leche',
      cache,
      emit: (event) => againEvents.push(event),
      searcher: { async search() { return [...hits, extra]; } },
    });
    await second.finish();
    const more = againEvents[1];
    if (more?.t !== 'search_compare' || more.status === 'pending') assert.fail('expected a second card');
    assert.equal(more.coto[0]?.id, 'c-new');
  });

  it('tries a wider query before saying the type is missing', async () => {
    const calls: string[] = [];
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const search = beginChainSearch({
      chain: 'coto',
      id: 'wide',
      query: 'pastas',
      cache,
      emit: (event) => events.push(event),
      searcher: {
        async search(query) {
          calls.push(query);
          if (query === 'fideo') {
            return [{ ...coto(1500), id: 'fideos', name: 'Fideos spaghetti' }];
          }
          return [];
        },
      },
    });
    const note = await search.finish();
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') assert.fail('expected a card');
    assert.deepEqual(calls, ['pastas', 'fideo']);
    assert.equal(finished.noPair, undefined);
    assert.equal(finished.coto[0]?.id, 'fideos');
    assert.ok((cache.searches?.find((row) => row.retailer === 'coto')?.available ?? 0) > 0);
    assert.doesNotMatch(note, /noPair/);

    const diaEvents: UiEvent[] = [];
    const diaSearch = beginChainSearch({
      chain: 'dia',
      id: 'wide-dia',
      query: 'pastas',
      cache: emptyCache(),
      emit: (event) => diaEvents.push(event),
      searchDia: async (term) => {
        assert.equal(term, 'fideo');
        return {
          failed: false,
          products: [{ ...dia(1800), skuId: 'dia-fideos', name: 'Fideos spaghetti' }],
        };
      },
    });
    await diaSearch.finish({ products: [], failed: false });
    const diaCard = diaEvents[1];
    if (diaCard?.t !== 'search_compare' || diaCard.status === 'pending') assert.fail('expected a día card');
    assert.equal(diaCard.noPair, undefined);
    assert.equal(diaCard.dia[0]?.id, 'dia-fideos');

    const emptyEvents: UiEvent[] = [];
    const empty = beginChainSearch({
      chain: 'coto',
      id: 'none',
      query: 'pastas',
      cache: emptyCache(),
      emit: (event) => emptyEvents.push(event),
      searcher: { async search() { return []; } },
    });
    await empty.finish();
    const missing = emptyEvents[1];
    if (missing?.t !== 'search_compare' || missing.status === 'pending') assert.fail('expected an empty card');
    assert.deepEqual(missing.noPair, ['coto']);
  });

  it('does not call a cart line missing, and prefers a remembered SKU', async () => {
    const events: UiEvent[] = [];
    const cache = emptyCache();
    cache.cart = {
      retailer: 'coto',
      cartId: 'coto-1',
      lines: [
        {
          index: 0,
          skuId: 'held',
          name: 'Leche entera',
          quantity: 1,
          sellerId: '1',
          unitPrice: { centavos: 2000, display: '$20' },
          lineTotal: { centavos: 2000, display: '$20' },
          available: true,
        },
      ],
      total: { centavos: 2000, display: '$20' },
      messages: [],
    };
    const search = beginChainSearch({
      chain: 'coto',
      id: 'held',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      searcher: { async search() { return []; } },
    });
    const note = await search.finish();
    const finished = events[1];
    if (finished?.t !== 'search_compare' || finished.status === 'pending') assert.fail('expected a card');
    assert.equal(finished.noPair, undefined);
    assert.match(note, /inCart=held/);

    const remembered = emptyCache();
    remembered.coto = {
      paper: {
        id: 'paper',
        name: 'Papel Higienico Campanita Soft 4 u',
        shelfCentavos: 4500,
        available: true,
      },
    };
    const seenEvents: UiEvent[] = [];
    const again = beginChainSearch({
      chain: 'coto',
      id: 'seen',
      query: 'papel higienico campanita soft',
      cache: remembered,
      emit: (event) => seenEvents.push(event),
      searcher: {
        async search() {
          return [{ ...coto(100), id: 'napkins', name: 'Servilletas Campanita Soft' }];
        },
      },
    });
    const seenNote = await again.finish();
    const card = seenEvents[1];
    if (card?.t !== 'search_compare' || card.status === 'pending') assert.fail('expected a card');
    assert.equal(card.coto[0]?.id, 'paper');
    assert.equal(card.coto[0]?.shelfCentavos, 4500);
    assert.match(seenNote, /seen=paper/);

    // Already drawn, and the live search only returns napkins. Score still wins.
    const shown = emptyCache();
    shown.coto = remembered.coto;
    shown.shown = ['paper'];
    const shownEvents: UiEvent[] = [];
    const shownSearch = beginChainSearch({
      chain: 'coto',
      id: 'shown-paper',
      query: 'papel higienico campanita soft',
      cache: shown,
      emit: (event) => shownEvents.push(event),
      searcher: {
        async search() {
          return [{ ...coto(100), id: 'napkins', name: 'Servilletas Campanita Soft' }];
        },
      },
    });
    const shownNote = await shownSearch.finish();
    const shownCard = shownEvents[1];
    if (shownCard?.t !== 'search_compare' || shownCard.status === 'pending') assert.fail('expected a card');
    assert.equal(shownCard.coto[0]?.id, 'paper');
    assert.match(shownNote, /pickCoto=paper/);
  });
});

describe('quiet build-cart search', () => {
  it('emits nothing for a quiet Coto search and still records the pick', async () => {
    const hit = coto(1500);
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const search = beginChainSearch({
      chain: 'coto',
      id: 'quiet-coto',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      quiet: true,
      searcher: {
        async search() {
          return [hit];
        },
      },
    });
    const note = await search.finish();
    assert.equal(events.length, 0);
    assert.match(note, /pickCoto=c1/);
    assert.equal(cache.searches?.find((row) => row.retailer === 'coto' && row.query === 'leche')?.available, 1);
    assert.equal(cache.coto?.c1?.name, 'Leche Protein 1 L');
  });

  it('emits nothing for a quiet dual search and still records the pick', async () => {
    const events: UiEvent[] = [];
    const cache = emptyCache();
    const search = beginDualSearch({
      id: 'quiet-dual',
      query: 'leche',
      cache,
      emit: (event) => events.push(event),
      quiet: true,
      searcher: {
        async search() {
          return [coto(1500)];
        },
      },
    });
    const note = await search.finish({ products: [dia(2000)], failed: false });
    assert.equal(events.length, 0);
    assert.match(note, /pickCoto=c1/);
    assert.equal(cache.searches?.some((row) => row.query === 'leche'), true);
    assert.deepEqual(cache.compared, ['d1']);
  });
});
