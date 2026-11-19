import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BRAND_MARK,
  COPYRIGHT_LINE,
  COPYRIGHT_YEAR,
  FOUNDER_SENTENCE,
  FOUNDERS,
  NEW_TAB_HINT,
  TRUST_LINE,
  TRUST_SEPARATOR,
} from './copy.ts';

test('the trust line is the 2026 lockup with a real registered mark', () => {
  assert.equal(COPYRIGHT_YEAR, 2026);
  assert.equal(BRAND_MARK, 'Changuito\u00AE');
  assert.equal(COPYRIGHT_LINE, '© 2026 Changuito\u00AE');
  assert.equal(FOUNDER_SENTENCE, 'Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(TRUST_SEPARATOR, ' \u00B7 ');
  assert.equal(TRUST_LINE, '© 2026 Changuito\u00AE · Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(TRUST_LINE.includes('\u2014'), false);
  assert.equal(TRUST_LINE.includes('\u2013'), false);
  assert.equal(TRUST_LINE.includes('(R)'), false);
  assert.equal(TRUST_LINE.split('\u00AE').length - 1, 1);
  assert.equal(NEW_TAB_HINT, 'se abre en una pestaña nueva');
  assert.deepEqual(
    FOUNDERS.map((person) => ({ name: person.name, href: person.href })),
    [
      { name: 'SimonethG', href: 'https://www.linkedin.com/in/simonethg/' },
      { name: 'Fabio', href: 'https://www.linkedin.com/in/fabio-laura-yavi/' },
    ],
  );
});
