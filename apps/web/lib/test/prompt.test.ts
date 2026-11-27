import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { changuitoPrompt, payBanner, stateBanner } from '../agent/prompt.ts';

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
    assert.equal(
      stateBanner({ retailer: 'coto', postalCode: '1425', order: 'coto', pay: 'button' }),
      '[session: coto, CP 1425, order coto, cart empty, pay button]',
    );
    assert.equal(
      stateBanner({ retailer: 'coto', postalCode: '1425', order: 'coto', pay: 'gate' }),
      '[session: coto, CP 1425, order coto, cart empty, pay gate]',
    );
    assert.equal(
      payBanner({
        order: 'coto',
        retailer: 'coto',
        cotoPay: true,
        lines: [{ available: true, quantity: 1 }],
        totalCentavos: 100,
      }),
      'button',
    );
    assert.equal(
      payBanner({
        order: 'coto',
        retailer: 'coto',
        cotoPay: true,
        dualCheckout: true,
        lines: [{ available: true, quantity: 1 }],
        totalCentavos: 100,
      }),
      'gate',
    );
    assert.equal(payBanner({ order: 'dia', retailer: 'dia', cotoPay: true }), undefined);
    for (const lang of ['es', 'en'] as const) {
      const prompt = changuitoPrompt(lang);
      assert.match(prompt, /pay button/);
      assert.match(prompt, /pay gate/);
      assert.match(prompt, /Name the "Pagar" button only when the banner says pay button/);
      assert.match(prompt, /Any text before a tool call is at most/);
      assert.match(prompt, /one short line, in the shopper's language, saying what is being searched/);
      assert.match(prompt, /Armar carrito/);
      assert.doesNotMatch(prompt, /from the "Pagar" button/);
    }
  });

  it('tells a build-cart turn not to search again or draw a product grid', () => {
    for (const lang of ['es', 'en'] as const) {
      const prompt = changuitoPrompt(lang);
      assert.match(prompt, /Do not search for alternatives and do not call render_products/);
      assert.match(prompt, /A build-cart turn is the\s+exception: do not call render_products/);
      assert.match(prompt, /"Quiero seguir en Día\." or "Quiero seguir en Coto\." — call choose_retailer/);
      assert.match(prompt, /Do not call add_to_cart\. Later searches/);
    }
  });
});
