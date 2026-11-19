import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STARTERS } from '../agent/prompt.ts';
import { EARLY_LOCATION_ASK, earlyLocationAsk, mentionsPostalCode } from '../agent/early-ask.ts';

const first = (text: string) => earlyLocationAsk({ hasLocation: false, firstMessage: true, text });

describe('earlyLocationAsk', () => {
  it('asks in-process on the first message when there is no location and no postal code', () => {
    // The QA path: a guest taps a starter and waited 40s for this question.
    for (const s of STARTERS) assert.equal(first(s), EARLY_LOCATION_ASK, s);
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
