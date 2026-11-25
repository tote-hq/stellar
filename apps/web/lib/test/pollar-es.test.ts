import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codeDigitLabel, translatePollarText } from '../pollar-es.ts';

describe('translatePollarText', () => {
  it('translates the strings QA read in the login modal', () => {
    assert.equal(translatePollarText('Log in or sign up'), 'Ingresá o creá tu cuenta');
    assert.equal(translatePollarText('Submit'), 'Continuar');
  });

  it('leaves anything it does not know exactly as it was', () => {
    assert.equal(translatePollarText('Log in or sign up now'), null);
    assert.equal(translatePollarText('vos@example.com'), null);
    assert.equal(translatePollarText('   '), null);
  });

  it('names each box of the email code for a screen reader', () => {
    assert.equal(codeDigitLabel(0, 6), 'Dígito 1 de 6 del código');
    assert.equal(codeDigitLabel(5, 6), 'Dígito 6 de 6 del código');
  });
});
