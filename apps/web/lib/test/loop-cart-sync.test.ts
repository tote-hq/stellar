import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Cart } from '@changuito/mcp/types';

import { syncRailCart } from '../agent/cart-sync.ts';
import { stateBanner } from '../agent/prompt.ts';
import { autoRenderCart, emptyCache } from '../agent/render-tools.ts';
import type { UiEvent } from '../protocol.ts';

function cotoCart(): Cart {
  return {
    retailer: 'coto',
    cartId: 'coto-1',
    lines: [
      {
        index: 0,
        skuId: 'c1',
        name: 'Provoleta',
        quantity: 1,
        sellerId: 'coto',
        unitPrice: { centavos: 1000, display: '$10' },
        lineTotal: { centavos: 1000, display: '$10' },
        available: true,
      },
    ],
    total: { centavos: 1000, display: '$10,00' },
    messages: [],
  };
}

describe('rail cart sync', () => {
  it('calls view_cart before the model, fills the banner, and draws no card', async () => {
    const cache = emptyCache();
    let calls = 0;
    const events: UiEvent[] = [];
    const synced = await syncRailCart({
      cache,
      cotoLines: 1,
      diaCartId: undefined,
      viewCart: async () => {
        calls += 1;
        return { ok: true, structured: { cart: cotoCart() } };
      },
    });
    assert.equal(synced, 'ready');
    assert.equal(calls, 1);
    assert.equal(cache.cart?.lines.length, 1);
    assert.equal(
      stateBanner({
        retailer: 'dia',
        postalCode: '1425',
        order: 'coto',
        cartLines: cache.cart?.lines.length,
        cartTotal: cache.cart?.total.display,
      }),
      '[session: dia, CP 1425, order coto, cart 1 line(s), $10,00]',
    );
    assert.equal(autoRenderCart(cache, (event) => events.push(event)), false);
    assert.equal(events.length, 0);
  });

  it('a view_cart error is cart unknown, never cart empty', async () => {
    const cache = emptyCache();
    const synced = await syncRailCart({
      cache,
      cotoLines: 2,
      diaCartId: undefined,
      viewCart: async () => ({ ok: false }),
    });
    assert.equal(synced, 'unknown');
    assert.equal(cache.cart, undefined);
    const banner = stateBanner({ retailer: 'coto', postalCode: '1425', order: 'coto', cartUnknown: true });
    assert.match(banner, /cart unknown/);
    assert.equal(banner.includes('cart empty'), false);
  });
});
