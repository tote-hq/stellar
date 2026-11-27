import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPetFood, ofQueryType, queryHead, typeScore, widerQueries } from '../catalog/food-type.js';

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

  it('scores the head double and zero when the hit is not the type', () => {
    const paper = { name: 'Papel Higienico Campanita Soft 4 u' };
    const napkins = { name: 'Servilletas Campanita Soft' };
    const asado = { name: 'Asado de cerdo' };
    const chop = { name: 'Chuleta de cerdo' };
    assert.ok(typeScore('papel higienico campanita soft', paper) > typeScore('papel higienico campanita soft', napkins));
    assert.ok(typeScore('asado de cerdo', asado) > typeScore('asado de cerdo', chop));
    assert.equal(typeScore('leche', { name: 'Leche entera' }), typeScore('leche', { name: 'Leche descremada' }));
    assert.equal(typeScore('leche', { name: 'Snack Carne Pedigree', brand: 'Pedigree' }), 0);
    assert.equal(typeScore('', paper), 0);
  });

  it('widens a missed query from the head and a short list', () => {
    assert.deepEqual(widerQueries('pastas'), ['fideo']);
    assert.deepEqual(widerQueries('spaghetti'), ['fideo spaghetti', 'tallarin']);
    assert.deepEqual(widerQueries('spaguetti'), ['fideo spaghetti', 'tallarin']);
    assert.deepEqual(widerQueries('huevos'), ['huevos blanco']);
    assert.deepEqual(widerQueries('parmesano'), ['queso rallado']);
    assert.deepEqual(widerQueries('panceta'), ['bacon']);
    assert.deepEqual(widerQueries('papel higienico'), ['papel']);
    assert.deepEqual(widerQueries('leche'), []);
  });
});
