import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPetFood, ofQueryType, queryHead } from '../catalog/food-type.js';

describe('food type', () => {
  it('rejects pet food as carne and spinach croquettes as nuggets', () => {
    assert.equal(isPetFood('Snack Tasty Bite Carne Pedigree', 'Pedigree'), true);
    assert.equal(ofQueryType('carne', { name: 'Snack Tasty Bite Carne Pedigree', brand: 'Pedigree' }), false);
    assert.equal(ofQueryType('nuggets', { name: 'Croquetas de Espinaca Día' }), false);
  });

  it('accepts a picada as carne and chicken nuggets as nuggets', () => {
    assert.equal(ofQueryType('carne', { name: 'Picada Ciudad del Lago' }), true);
    assert.equal(ofQueryType('nuggets', { name: 'Nuggets Crocantes Artico' }), true);
  });

  it('treats both protein milks as leche con proteinas', () => {
    assert.equal(ofQueryType('leche con proteinas', { name: 'La Serenísima Protein' }), true);
    assert.equal(ofQueryType('leche con proteinas', { name: 'Leche Las Tres Niñas Vida Activa' }), true);
  });

  it('folds accents and a trailing plural into the head', () => {
    assert.equal(queryHead('nuggets'), 'nugget');
    assert.equal(queryHead('leche con proteinas'), 'leche');
    assert.equal(ofQueryType('Nuggets', { name: 'Nuggets Crocantes Ártico' }), true);
    assert.equal(ofQueryType('leche', { name: 'Leche Descremada' }), true);
  });

  it('matches nothing for an empty query', () => {
    assert.equal(queryHead(''), '');
    assert.equal(queryHead('de la'), '');
    assert.equal(ofQueryType('', { name: 'Picada Ciudad del Lago' }), false);
    assert.equal(ofQueryType('   ', { name: 'Leche' }), false);
  });
});
