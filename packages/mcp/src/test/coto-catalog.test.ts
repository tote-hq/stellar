import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAdapter, listRetailers, RETAILER_IDS } from '../adapters/registry.js';
import { selectExact, toCatalogItem, type CatalogItem, type CotoSearchHit } from '../catalog/coto.js';
import { matchDiaToCoto, pickMatch, scoreCandidate } from '../catalog/match.js';
import { normalizeBrand, sizeFromName, sizesEqual } from '../catalog/normalize.js';
import type { Product } from '../types.js';
import { fromPesos } from '../util/money.js';

function hit(
  data: NonNullable<CotoSearchHit['data']> = {},
  value = 'Leche Larga Vida Entera LA SERENISIMA 1l',
): CotoSearchHit {
  return {
    value,
    data: {
      id: 'prod-test',
      url: '_/R-test',
      image_url: 'https://example.test/img.jpg',
      price: [{ store: '061', listPrice: 1, formatPrice: 9999 }, { store: '200', listPrice: 3030, formatPrice: 1 }],
      product_list_price: 3030,
      product_main_ean: '7790000000001',
      product_brand: 'LA SERENISIMA',
      product_format: 'Litro',
      product_format_quantity: 1,
      store_availability: ['061', '200'],
      ...data,
    },
  };
}

function item(name: string, data: NonNullable<CotoSearchHit['data']> = {}): CatalogItem {
  const built = toCatalogItem(hit(data, name));
  assert.ok(built, name);
  return built;
}

function dia(partial: Pick<Product, 'name'> & Partial<Product>): Product {
  return {
    skuId: 'sku-1',
    productId: 'p-1',
    sellerId: '1',
    price: fromPesos(10),
    available: true,
    ...partial,
  };
}

describe('toCatalogItem', () => {
  it('reads the store 200 listPrice and ignores formatPrice, discounts, and Comunidad', () => {
    const built = toCatalogItem(hit({
      discounts: [{ discountText: '70% 2da', discountPrice: '$1', regularPrice: 1 }],
      comunidadPrice: 1,
      price: [
        { store: '061', listPrice: 1, formatPrice: 9999, priceWithoutTax: 1 },
        { store: '200', listPrice: 3030, formatPrice: 1, priceWithoutTax: 1 },
      ],
    }));
    assert.ok(built);
    assert.equal(built.id, 'prod-test');
    assert.equal(built.priceSource, 'store_200');
    assert.equal(built.shelfPrice.centavos, fromPesos(3030).centavos);
    assert.equal(built.listPrice, undefined);
    assert.equal(built.ean, '7790000000001');
    assert.equal(built.brand, 'LA SERENISIMA');
    assert.equal(built.available, true);
    assert.equal(built.url, 'https://www.coto.com.ar/_/R-test');
    assert.equal(built.imageUrl, 'https://example.test/img.jpg');
    assert.equal(built.size?.quantity, 1000);
    assert.equal(built.size?.unit, 'ml');
    assert.equal(built.size?.source, 'name');
    assert.equal(built.unitBasis?.role, 'unit_price_basis');
    assert.equal(built.unitBasis?.format, 'Litro');
    assert.equal(built.unitBasis?.quantity, 1);
  });

  it('keeps product_format as the unit-price basis when the name says 500 g', () => {
    const built = toCatalogItem(hit({
      product_format: 'Kilo',
      product_format_quantity: 1,
      product_list_price: 1850,
      price: [{ store: '200', listPrice: 1850, formatPrice: 3700 }],
    }, 'Fideos Spaghetti 500g'));
    assert.ok(built);
    assert.equal(built.shelfPrice.centavos, fromPesos(1850).centavos);
    assert.equal(built.size?.text, '500g');
    assert.equal(built.size?.quantity, 500);
    assert.equal(built.size?.unit, 'g');
    assert.equal(built.size?.source, 'name');
    assert.equal(built.unitBasis?.format, 'Kilo');
    assert.equal(built.unitBasis?.quantity, 1);
  });

  it('falls back to product_list_price when store 200 has no positive listPrice', () => {
    const built = toCatalogItem(hit({
      price: [{ store: '200', listPrice: 0, formatPrice: 100 }, { store: '061', listPrice: 50 }],
      product_list_price: '2100',
    }));
    assert.ok(built);
    assert.equal(built.priceSource, 'product_list_price');
    assert.equal(built.shelfPrice.centavos, fromPesos(2100).centavos);
    assert.equal(built.listPrice, undefined);
  });

  it('sets listPrice only when product_list_price differs from the shelf', () => {
    const built = toCatalogItem(hit({
      price: [{ store: '200', listPrice: 9990, formatPrice: 333 }],
      product_list_price: 7999,
    }, 'Huevo blanco 30u'));
    assert.ok(built);
    assert.equal(built.priceSource, 'store_200');
    assert.equal(built.shelfPrice.centavos, fromPesos(9990).centavos);
    assert.equal(built.listPrice?.centavos, fromPesos(7999).centavos);
  });

  it('drops a hit with no positive shelf', () => {
    assert.equal(toCatalogItem(hit({
      price: [{ store: '200', formatPrice: 3700 }],
      product_list_price: 0,
    })), null);
    assert.equal(toCatalogItem(hit({ price: [], product_list_price: undefined })), null);
    assert.equal(toCatalogItem(hit({ id: '' })), null);
  });

  it('marks availability from store 200 only', () => {
    assert.equal(toCatalogItem(hit({ store_availability: ['061'] }))?.available, false);
    assert.equal(toCatalogItem(hit({ store_availability: undefined }))?.available, false);
    const numeric = toCatalogItem(hit({
      price: [{ store: 200, listPrice: 3030 }],
    }));
    assert.equal(numeric?.priceSource, 'store_200');
  });

  it('stringifies a numeric EAN and keeps an absolute image URL', () => {
    const built = toCatalogItem(hit({
      product_main_ean: 7790000000001,
      image_url: undefined,
      product_large_image_url: 'https://example.test/large.jpg',
      url: 'https://www.coto.com.ar/producto/1',
    }));
    assert.equal(built?.ean, '7790000000001');
    assert.equal(built?.imageUrl, 'https://example.test/large.jpg');
    assert.equal(built?.url, 'https://www.coto.com.ar/producto/1');
  });
});

describe('selectExact', () => {
  const row = item('Leche 1l', { id: 'prod-1', product_main_ean: '7790000000001' });

  it('returns the exact id or EAN and nothing nearby', () => {
    assert.equal(selectExact('prod-1', [row])?.id, 'prod-1');
    assert.equal(selectExact('7790000000001', [row])?.id, 'prod-1');
    assert.equal(selectExact('0007790000000001', [row])?.id, 'prod-1');
    assert.equal(selectExact('prod-2', [row]), null);
    assert.equal(selectExact('7790000000002', [row]), null);
    assert.equal(selectExact('', [row]), null);
  });
});

describe('normalize', () => {
  it('canonicalises weight, volume, count, and multipacks from the name', () => {
    const kgm = sizeFromName('Arroz Largo Fino 1 Kgm');
    const kg = sizeFromName('Azúcar 1kg');
    const grams = sizeFromName('Azúcar 1000 g');
    assert.ok(kgm && kg && grams);
    assert.equal(kgm.text, '1 Kgm');
    assert.equal(kgm.source, 'name');
    assert.ok(sizesEqual(kgm, kg));
    assert.ok(sizesEqual(kg, grams));
    assert.ok(sizesEqual(kg, sizeFromName('Arroz 1 kilo')!));
    assert.ok(sizesEqual(kg, sizeFromName('Arroz 1 kilogramo')!));
    assert.equal(kg.quantity, 1000);
    assert.equal(kg.unit, 'g');

    const liters = sizeFromName('Aceite 1.5 L');
    const ml = sizeFromName('Aceite 1500 ml');
    assert.ok(liters && ml);
    assert.ok(sizesEqual(liters, ml));
    assert.equal(liters.quantity, 1500);
    assert.equal(liters.unit, 'ml');
    assert.equal(sizeFromName('Jugo 330 cc')?.quantity, 330);
    assert.equal(sizeFromName('Jugo 330 cc')?.unit, 'ml');

    const eggs = sizeFromName('Huevo blanco 30u');
    assert.equal(eggs?.quantity, 30);
    assert.equal(eggs?.unit, 'u');
    assert.equal(eggs?.count, undefined);

    const inline = sizeFromName('Papel 4x30 M');
    const words = sizeFromName('Papel Higiénico 30 M 4 Un');
    const flipped = sizeFromName('Papel 4 Un 30 M');
    assert.ok(inline && words && flipped);
    assert.equal(words.text, '30 M 4 Un');
    assert.equal(inline.count, 4);
    assert.equal(inline.each?.quantity, 30);
    assert.equal(inline.each?.unit, 'm');
    assert.equal(inline.source, 'name');
    assert.ok(sizesEqual(inline, words));
    assert.ok(sizesEqual(words, flipped));
    assert.equal(sizesEqual(sizeFromName('Papel 30 M')!, inline), false);

    const bottles = sizeFromName('Aceite 4x1.5 L');
    const bottlesWords = sizeFromName('Aceite 1.5 L 4 Un');
    assert.ok(bottles && bottlesWords);
    assert.ok(sizesEqual(bottles, bottlesWords));
    assert.equal(bottles.each?.quantity, 1500);
    assert.equal(bottles.each?.unit, 'ml');
  });

  it('folds accents, case, and punctuation in a brand', () => {
    assert.equal(normalizeBrand('LA SERENÍSIMA'), normalizeBrand('La Serenisima'));
    assert.equal(normalizeBrand('  dos   hnos. '), 'DOS HNOS');
  });
});

describe('pickMatch', () => {
  it('lets an exact EAN win over a brand and size hit', () => {
    const byBrand = item('Fideos Spaghetti Lucchetti 500g', {
      id: 'brand',
      product_brand: 'LUCCHETTI',
      product_main_ean: '1000000000001',
    });
    const byEan = item('Otra cosa 1kg', {
      id: 'ean',
      product_brand: 'OTRA',
      product_main_ean: '7790000000001',
    });
    const result = pickMatch(
      { name: 'Fideos spaghetti 500 gr', brand: 'Lucchetti', ean: '0007790000000001' },
      [byBrand, byEan],
    );
    assert.equal(result.confidence, 'ean');
    assert.equal(result.match?.id, 'ean');
  });

  it('does not match the same brand at a different size', () => {
    const other = item('Leche entera 500 ml', {
      id: 'other',
      product_brand: 'LA SERENISIMA',
      product_main_ean: '1000000000002',
    });
    const result = pickMatch({ name: 'Leche entera 1l', brand: 'La Serenísima' }, [other]);
    assert.deepEqual(result, { match: null, confidence: 'none' });
  });

  it('does not match on brand alone or name alone', () => {
    const brandOnly = item('Yerba Mate PLAYADITO 500g', {
      id: 'brand-only',
      product_brand: 'PLAYADITO',
    });
    const nameOnly = item('Yerba Mate Suave PLAYADITO 1 Kg', {
      id: 'name-only',
      product_brand: 'OTRA',
    });
    const diaName = { name: 'Yerba Mate Suave PLAYADITO 1 Kg', brand: 'Playadito' };
    assert.equal(pickMatch(diaName, [brandOnly]).confidence, 'none');
    assert.equal(pickMatch(diaName, [nameOnly]).confidence, 'none');
  });

  it('is none when Día has no brand', () => {
    const same = item('Leche entera 1l', { id: 'same', product_brand: 'LA SERENISIMA' });
    assert.equal(pickMatch({ name: 'Leche entera 1l' }, [same]).confidence, 'none');
  });

  it('picks the closest name when several packs share brand and size', () => {
    const mostachol = item('Fideos Mostachol Lucchetti 500g', {
      id: 'mostachol',
      product_brand: 'LUCCHETTI',
    });
    const spaghetti = item('Fideos Spaghetti Lucchetti 500g', {
      id: 'spaghetti',
      product_brand: 'Lucchetti',
    });
    const result = pickMatch(
      { name: 'Fideos Spaghetti Lucchetti 500g', brand: 'LUCCHETTI' },
      [mostachol, spaghetti],
    );
    assert.equal(result.confidence, 'brand_size_unit');
    assert.equal(result.match?.id, 'spaghetti');
    assert.ok(scoreCandidate('Fideos Spaghetti Lucchetti 500g', spaghetti.name)
      > scoreCandidate('Fideos Spaghetti Lucchetti 500g', mostachol.name));
  });
});

describe('matchDiaToCoto', () => {
  it('searches the EAN before the brand', async () => {
    const calls: string[] = [];
    const eanItem = item('Otra 1l', { id: 'ean', product_main_ean: '7790000000001', product_brand: 'Z' });
    const result = await matchDiaToCoto(
      dia({
        name: 'Leche entera 1l',
        brand: 'LA SERENISIMA',
        ean: '7790000000001',
        unitMultiplier: 500,
        measurementUnit: 'ml',
      }),
      {
        async search(query: string) {
          calls.push(query);
          return query === '7790000000001' ? [eanItem] : [];
        },
      },
    );
    assert.deepEqual(calls, ['7790000000001']);
    assert.equal(result.confidence, 'ean');
    assert.equal(result.match?.id, 'ean');
  });

  it('does not treat unitMultiplier as the pack size', async () => {
    const wrong = item('Leche entera 500 ml', {
      id: 'wrong',
      product_brand: 'LA SERENISIMA',
      product_main_ean: '1000000000002',
    });
    const calls: string[] = [];
    const result = await matchDiaToCoto(
      dia({
        name: 'Leche entera 1 L',
        brand: 'La Serenisima',
        unitMultiplier: 500,
        measurementUnit: 'ml',
      }),
      {
        async search(query: string) {
          calls.push(query);
          return [wrong];
        },
      },
    );
    assert.equal(result.confidence, 'none');
    assert.equal(result.match, null);
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? '', /LA SERENISIMA/);
    assert.match(calls[0] ?? '', /Leche entera/);
  });
});

describe('registry', () => {
  it('keeps coto out of the adapters that build carts', () => {
    const ids: readonly string[] = RETAILER_IDS;
    assert.equal(ids.includes('coto'), false);
    assert.equal(listRetailers().some((retailer) => retailer.id === 'coto'), false);
    assert.throws(() => getAdapter('coto'), /not supported/);
  });
});
