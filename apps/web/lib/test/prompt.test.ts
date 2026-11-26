import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { changuitoPrompt, stateBanner } from '../agent/prompt.ts';

describe('Coto-only prompt', () => {
  it('drops the cannot-be-paid line and keeps the Coto-only rule in both languages', () => {
    for (const lang of ['es', 'en'] as const) {
      const prompt = changuitoPrompt(lang);
      assert.equal(/cannot be paid/i.test(prompt), false, lang);
      assert.match(prompt, /order coto/);
      assert.match(prompt, /talk only about Coto/);
      assert.match(prompt, /cart unknown/);
    }
    assert.equal(
      stateBanner({ retailer: 'dia', postalCode: '1425', cartUnknown: true }),
      '[session: dia, CP 1425, cart unknown]',
    );
    assert.equal(
      stateBanner({ retailer: 'coto', postalCode: '1425', order: 'coto', cartLines: 2, cartTotal: '$10' }),
      '[session: coto, CP 1425, order coto, cart 2 line(s), $10]',
    );
  });
});
