import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogItem } from '../catalog/coto.js';
import { assembleSearchCompare, searchCompare } from '../catalog/search-compare.js';
import type { Product } from '../types.js';

function dia(over: Partial<Product> = {}): Product {
  return {
    skuId: 'd1',
    productId: 'p1',
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean: '7790001',
    sellerId: '1',
    price: { centavos: 247500, display: '$2.475,00' },
    available: true,
    ...over,
  };
}

function coto(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'c1',
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean: '7790001',
    shelfPrice: { centavos: 229000, display: '$2.290,00' },
    priceSource: 'store_200',
    available: true,
    ...over,
  };
}

describe('searchCompare', () => {
  it('uses the first confident available pair and the absolute gap', async () => {
    const dearerCoto = coto({
      id: 'c-dear',
      ean: '7790002',
      shelfPrice: { centavos: 300000, display: '$3.000,00' },
    });
    const match = coto();
    const result = await searchCompare('leche', [dia(), dia({ skuId: 'd2', ean: '7790002', available: false })], {
      coto: { async search() { return [match, dearerCoto]; } },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.pair?.diaSkuId, 'd1');
    assert.equal(result.pair?.cotoId, 'c1');
    assert.equal(result.gapCentavos, Math.abs(247500 - 229000));

    const flipped = assembleSearchCompare({
      query: 'leche',
      diaProducts: [dia({ price: { centavos: 1000, display: '$10,00' } })],
      diaFailed: false,
      coto: { ok: true, items: [coto({ shelfPrice: { centavos: 2500, display: '$25,00' } })] },
    });
    assert.equal(flipped.gapCentavos, 1500);
  });

  it('reports an empty, failed, or timed-out Coto lookup with no zero-price rows', () => {
    const products = [dia()];
    const empty = assembleSearchCompare({ query: 'leche', diaProducts: products, diaFailed: false, coto: { ok: true, items: [] } });
    assert.equal(empty.status, 'coto_empty');
    assert.deepEqual(empty.coto, []);
    assert.equal(empty.gapCentavos, undefined);

    const failed = assembleSearchCompare({
      query: 'leche',
      diaProducts: products,
      diaFailed: false,
      coto: { ok: false, reason: 'error' },
    });
    assert.equal(failed.status, 'coto_error');
    assert.deepEqual(failed.coto, []);

    const timed = assembleSearchCompare({
      query: 'leche',
      diaProducts: products,
      diaFailed: false,
      coto: { ok: false, reason: 'timed_out' },
    });
    assert.equal(timed.status, 'coto_timed_out');
    assert.equal(timed.pair, undefined);
  });

  it('keeps Coto hits when Día failed and does not invent a gap', () => {
    const result = assembleSearchCompare({
      query: 'leche',
      diaProducts: [],
      diaFailed: true,
      coto: { ok: true, items: [coto()] },
    });
    assert.equal(result.status, 'dia_error');
    assert.equal(result.coto.length, 1);
    assert.equal(result.gapCentavos, undefined);
  });

  it('skips a pair that is not available on both sides', () => {
    const result = assembleSearchCompare({
      query: 'leche',
      diaProducts: [dia()],
      diaFailed: false,
      coto: { ok: true, items: [coto({ available: false })] },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.pair, undefined);
    assert.equal(result.gapCentavos, undefined);
  });

  it('pairs the video queries by food type and withholds a gap unless the product is the same', () => {
    const carne = assembleSearchCompare({
      query: 'carne',
      diaProducts: [dia({ skuId: 'pedigree', name: 'Snack Tasty Bite Carne Pedigree', brand: 'Pedigree', ean: undefined })],
      diaFailed: false,
      coto: {
        ok: true,
        items: [coto({ id: 'picada', name: 'Picada Ciudad del Lago', brand: 'Ciudad del Lago', ean: undefined, shelfPrice: { centavos: 500000, display: '$5.000,00' } })],
      },
    });
    assert.equal(carne.cotoPick?.id, 'picada');
    assert.equal(carne.diaPick, undefined);
    assert.equal(carne.match, 'none');
    assert.equal(carne.pair, undefined);
    assert.equal(carne.gapCentavos, undefined);

    const nuggets = assembleSearchCompare({
      query: 'nuggets',
      diaProducts: [dia({ skuId: 'espinaca', name: 'Croquetas de Espinaca Día', brand: 'Día', ean: undefined })],
      diaFailed: false,
      coto: {
        ok: true,
        items: [coto({ id: 'artico', name: 'Nuggets Crocantes Artico', brand: 'Artico', ean: undefined, shelfPrice: { centavos: 420000, display: '$4.200,00' } })],
      },
    });
    assert.equal(nuggets.cotoPick?.id, 'artico');
    assert.equal(nuggets.diaPick, undefined);
    assert.equal(nuggets.match, 'none');
    assert.equal(nuggets.gapCentavos, undefined);

    const milk = assembleSearchCompare({
      query: 'leche con proteinas',
      diaProducts: [dia({ skuId: 'serenisima', name: 'La Serenísima Protein', brand: 'La Serenísima', ean: undefined, price: { centavos: 300000, display: '$3.000,00' } })],
      diaFailed: false,
      coto: {
        ok: true,
        items: [coto({ id: 'tres', name: 'Leche Las Tres Niñas Vida Activa', brand: 'Las Tres Niñas', ean: undefined, shelfPrice: { centavos: 280000, display: '$2.800,00' } })],
      },
    });
    assert.equal(milk.diaPick?.id, 'serenisima');
    assert.equal(milk.cotoPick?.id, 'tres');
    assert.equal(milk.match, 'similar');
    assert.equal(milk.pair, undefined);
    assert.equal(milk.gapCentavos, undefined);
  });

  it('sets the gap only when the two picks are the same product', () => {
    const byEan = assembleSearchCompare({
      query: 'leche',
      diaProducts: [dia({ ean: '779111', price: { centavos: 2000, display: '$20,00' } })],
      diaFailed: false,
      coto: { ok: true, items: [coto({ ean: '779111', shelfPrice: { centavos: 1500, display: '$15,00' } })] },
    });
    assert.equal(byEan.match, 'same');
    assert.equal(byEan.gapCentavos, 500);
    assert.equal(byEan.pair?.confidence, 'ean');

    const byBrand = assembleSearchCompare({
      query: 'leche',
      diaProducts: [dia({ name: 'Leche Protein 1 L', brand: 'Serenisima', ean: undefined, price: { centavos: 4000, display: '$40,00' } })],
      diaFailed: false,
      coto: {
        ok: true,
        items: [coto({ name: 'Leche Protein 1 L', brand: 'Serenisima', ean: undefined, shelfPrice: { centavos: 2500, display: '$25,00' } })],
      },
    });
    assert.equal(byBrand.match, 'same');
    assert.equal(byBrand.pair?.confidence, 'brand_size_unit');
    assert.equal(byBrand.gapCentavos, 1500);
  });

  it('never pairs pet food, and a Día-only type has no gap', () => {
    const pets = assembleSearchCompare({
      query: 'carne',
      diaProducts: [dia({ name: 'Snack Tasty Bite Carne Pedigree', brand: 'Pedigree', ean: '7799' })],
      diaFailed: false,
      coto: { ok: true, items: [coto({ name: 'Dog Chow Carne Adulto', brand: 'Dog Chow', ean: '7799' })] },
    });
    assert.equal(pets.diaPick, undefined);
    assert.equal(pets.cotoPick, undefined);
    assert.equal(pets.pair, undefined);
    assert.equal(pets.gapCentavos, undefined);

    const diaOnly = assembleSearchCompare({
      query: 'leche',
      diaProducts: [dia()],
      diaFailed: false,
      coto: { ok: true, items: [coto({ name: 'Yerba Mate 1 Kg', brand: 'Playadito', ean: '1' })] },
    });
    assert.equal(diaOnly.diaPick?.id, 'd1');
    assert.equal(diaOnly.cotoPick, undefined);
    assert.equal(diaOnly.match, 'none');
    assert.equal(diaOnly.gapCentavos, undefined);
  });

  it('picks the cheapest hit in the best-matching tier', () => {
    const paper = (id: string, centavos: number, ean: string) =>
      coto({
        id,
        name: 'Papel Higienico Campanita Soft 4 u',
        ean,
        shelfPrice: { centavos, display: '$0' },
      });
    const napkins = coto({
      id: 'napkins',
      name: 'Servilletas Campanita Soft',
      ean: '7799999',
      shelfPrice: { centavos: 100, display: '$0' },
    });
    const ranked = assembleSearchCompare({
      query: 'papel higienico campanita soft',
      diaProducts: [
        dia({
          skuId: 'dia-paper',
          name: 'Papel Higienico Campanita Soft 4 u',
          ean: '7791111',
          price: { centavos: 5000, display: '$0' },
        }),
        dia({
          skuId: 'dia-napkins',
          name: 'Servilletas Campanita Soft',
          ean: '7799999',
          price: { centavos: 100, display: '$0' },
        }),
      ],
      diaFailed: false,
      coto: { ok: true, items: [napkins, paper('coto-paper', 4000, '7791111')] },
    });
    assert.equal(ranked.cotoPick?.id, 'coto-paper');
    assert.equal(ranked.diaPick?.id, 'dia-paper');
    assert.equal(ranked.gapCentavos, 1000);

    const asado = assembleSearchCompare({
      query: 'asado de cerdo',
      diaProducts: [],
      diaFailed: false,
      coto: {
        ok: true,
        items: [
          coto({ id: 'chop', name: 'Chuleta de cerdo', shelfPrice: { centavos: 100, display: '$0' } }),
          coto({ id: 'roast', name: 'Asado de cerdo', shelfPrice: { centavos: 900, display: '$0' } }),
        ],
      },
    });
    assert.equal(asado.cotoPick?.id, 'roast');

    const milk = assembleSearchCompare({
      query: 'leche',
      diaProducts: [dia({ price: { centavos: 3000, display: '$0' } })],
      diaFailed: false,
      coto: {
        ok: true,
        items: [
          coto({ id: 'dear', shelfPrice: { centavos: 4000, display: '$0' }, ean: '7790002' }),
          coto({ id: 'cheap', shelfPrice: { centavos: 500, display: '$0' } }),
        ],
      },
    });
    assert.equal(milk.cotoPick?.id, 'cheap');
  });
});
