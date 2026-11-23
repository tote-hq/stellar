import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STARTERS } from '../agent/prompt.ts';
import { EARLY_LOCATION_ASK, EARLY_LOCATION_ASK_EN, earlyLocationAsk, mentionsPostalCode } from '../agent/early-ask.ts';

const first = (text: string) => earlyLocationAsk({ hasLocation: false, firstMessage: true, text });

describe('earlyLocationAsk', () => {
  it('asks in-process on the first message when there is no location and no postal code', () => {
    // The QA path: a guest taps a starter and waited 40s for this question.
    for (const s of STARTERS) assert.equal(first(s), EARLY_LOCATION_ASK, s);
  });

  it('names Día and a postal code, in both languages, and does not ask which supermarket', () => {
    assert.equal(EARLY_LOCATION_ASK, 'Para buscar precios reales en Día necesito tu **código postal**. ¿Cuál es?');
    assert.equal(
      EARLY_LOCATION_ASK_EN,
      'To look up real prices at Día I need your **postcode**. What is it?',
    );
    assert.equal(earlyLocationAsk({ hasLocation: false, firstMessage: true, text: 'leche', lang: 'es' }), EARLY_LOCATION_ASK);
    assert.equal(earlyLocationAsk({ hasLocation: false, firstMessage: true, text: 'leche', lang: 'en' }), EARLY_LOCATION_ASK_EN);
    for (const line of [EARLY_LOCATION_ASK, EARLY_LOCATION_ASK_EN]) {
      assert.equal(/Jumbo|Disco|Carrefour/i.test(line), false, line);
    }
  });

  it('leaves a postal code, a known location, and a follow-up to the model', () => {
    // "no sé" after the question deserves a model that can help, not the same
    // question again. A code or a store already on the turn is the model's too.
    assert.equal(first('Compará leche en Día, CP 1414'), null);
    assert.equal(earlyLocationAsk({ hasLocation: true, firstMessage: true, text: 'leche' }), null);
    assert.equal(earlyLocationAsk({ hasLocation: false, firstMessage: false, text: 'no sé' }), null);
  });

  it('recognises a postal code and does not treat a price or a quantity as one', () => {
    for (const t of ['1414', 'CP 1414, Día', 'cp1414', 'estoy en 1414 palermo', 'C1414ABC', 'mi cpa es c1414abc']) {
      assert.equal(mentionsPostalCode(t), true, t);
    }
    for (const t of ['por menos de $10.000', 'con $10000', 'leche de 1 litro', '12 huevos', 'arroz 500g']) {
      assert.equal(mentionsPostalCode(t), false, t);
    }
  });
});
