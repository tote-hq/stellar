import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { cardImageUrl, cheapestAvailable } from '../one-per-type.ts';

describe('cheapestAvailable', () => {
  it('keeps the cheapest available item', () => {
    const picked = cheapestAvailable([
      { id: 'dear', available: true, shelfCentavos: 500 },
      { id: 'cheap', available: true, shelfCentavos: 100 },
      { id: 'mid', available: true, shelfCentavos: 200 },
    ]);
    assert.equal(picked?.id, 'cheap');
  });

  it('keeps the first item when the price ties', () => {
    const picked = cheapestAvailable([
      { id: 'first', available: true, shelfCentavos: 100 },
      { id: 'second', available: true, shelfCentavos: 100 },
    ]);
    assert.equal(picked?.id, 'first');
  });

  it('skips unavailable and non-positive prices', () => {
    const picked = cheapestAvailable([
      { id: 'gone', available: false, shelfCentavos: 50 },
      { id: 'free', available: true, shelfCentavos: 0 },
      { id: 'bad', available: true, shelfCentavos: 1.5 },
      { id: 'ok', available: true, shelfCentavos: 300 },
    ]);
    assert.equal(picked?.id, 'ok');
  });

  it('returns undefined when nothing can be shown', () => {
    assert.equal(cheapestAvailable([]), undefined);
    assert.equal(
      cheapestAvailable([{ id: 'gone', available: false, shelfCentavos: 100 }]),
      undefined,
    );
  });
});

describe('cardImageUrl', () => {
  it('keeps an absolute http(s) url and never prefixes a host', () => {
    assert.equal(cardImageUrl('https://img.example/a.jpg'), 'https://img.example/a.jpg');
    assert.equal(cardImageUrl('http://img.example/a.jpg'), 'http://img.example/a.jpg');
    assert.equal(cardImageUrl('  https://img.example/a.jpg  '), 'https://img.example/a.jpg');
    assert.equal(cardImageUrl('/a.jpg'), undefined);
    assert.equal(cardImageUrl('//img.example/a.jpg'), undefined);
    assert.equal(cardImageUrl('a.jpg'), undefined);
    assert.equal(cardImageUrl(''), undefined);
    assert.equal(cardImageUrl(undefined), undefined);
    assert.equal(cardImageUrl('https://img.example/a.jpg')?.startsWith('https://img.example'), true);
  });
});

describe('product card image fallback', () => {
  it('wires onError to the empty square', () => {
    const source = readFileSync(new URL('../../components/ProductGrid.tsx', import.meta.url), 'utf8');
    assert.match(source, /onError=\{\(\) => setFailedSrc\(src\)\}/);
    assert.match(source, /card-img-empty/);
    assert.match(source, /cardImageUrl\(imageUrl\)/);
  });
});
