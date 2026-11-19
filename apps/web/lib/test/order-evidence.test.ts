import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Cart, CartLine } from '@changuito/mcp/types';

import { decideOrderEvidence } from '../order-evidence.ts';
import { basketHash, toHex } from '../order.ts';

/**
 * Evidence for the release / refund / BasketMismatch rule, driven by five
 * fixture Día carts rather than the network. Live Día orders wait until the
 * release and refund path (and Channels submission) are on main; this file
 * pins the rule itself: a matching basket releases, a failed or expired
 * order refunds, and a wrong basket is rejected.
 */

const money = (centavos: number) => ({
  centavos,
  display: `$${(centavos / 100).toFixed(2).replace('.', ',')}`,
});

const line = (over: Partial<CartLine> & Pick<CartLine, 'index' | 'skuId' | 'name' | 'quantity' | 'lineTotal'>): CartLine => ({
  sellerId: '1',
  unitPrice: money(Math.round(over.lineTotal.centavos / over.quantity)),
  available: true,
  ...over,
});

const cart = (cartId: string, lines: CartLine[]): Cart => ({
  retailer: 'dia',
  cartId,
  lines,
  total: money(lines.reduce((sum, l) => sum + l.lineTotal.centavos, 0)),
  messages: [],
});

/** Five real-shaped Día baskets. Three release, two refund; wrong-cart uses #1. */
const FIXTURES = [
  {
    key: 'desayuno',
    orderId: '11'.repeat(32),
    store: 'confirmed' as const,
    expect: 'release' as const,
    cart: cart('dia-evidence-desayuno-01', [
      line({ index: 0, skuId: '800123', name: 'Leche descremada La Serenísima 1L', quantity: 2, lineTotal: money(298_000) }),
      line({ index: 1, skuId: '800456', name: 'Pan lactal Bimbo 350g', quantity: 1, lineTotal: money(189_000) }),
      line({ index: 2, skuId: '800789', name: 'Café molido La Virginia 500g', quantity: 1, lineTotal: money(412_000) }),
    ]),
  },
  {
    key: 'almuerzo',
    orderId: '22'.repeat(32),
    store: 'confirmed' as const,
    expect: 'release' as const,
    cart: cart('dia-evidence-almuerzo-02', [
      line({ index: 0, skuId: '801001', name: 'Fideos Matarazzo 500g', quantity: 2, lineTotal: money(240_000) }),
      line({ index: 1, skuId: '801002', name: 'Salsa de tomate Arcor 520g', quantity: 1, lineTotal: money(165_000) }),
      line({ index: 2, skuId: '801003', name: 'Aceite de girasol Natura 900ml', quantity: 1, lineTotal: money(320_000) }),
    ]),
  },
  {
    key: 'merienda',
    orderId: '33'.repeat(32),
    store: 'confirmed' as const,
    expect: 'release' as const,
    cart: cart('dia-evidence-merienda-03', [
      line({ index: 0, skuId: '802010', name: 'Yogur bebible Ser 1L', quantity: 2, lineTotal: money(310_000) }),
      line({ index: 1, skuId: '802011', name: 'Galletitas Oreo 118g', quantity: 1, lineTotal: money(145_000) }),
    ]),
  },
  {
    key: 'stock-fail',
    orderId: '44'.repeat(32),
    store: 'failed' as const,
    expect: 'refund' as const,
    cart: cart('dia-evidence-stock-fail-04', [
      line({ index: 0, skuId: '803100', name: 'Papel higiénico Higienol 30m x4', quantity: 1, lineTotal: money(520_000) }),
      line({
        index: 1,
        skuId: '803101',
        name: 'Detergente Magistral limón 750ml',
        quantity: 1,
        lineTotal: money(280_000),
        available: false,
      }),
    ]),
  },
  {
    key: 'expired',
    orderId: '55'.repeat(32),
    store: 'expired' as const,
    expect: 'refund' as const,
    cart: cart('dia-evidence-expired-05', [
      line({ index: 0, skuId: '804200', name: 'Agua Villavicencio 2L', quantity: 6, lineTotal: money(540_000) }),
      line({ index: 1, skuId: '804201', name: 'Gaseosa Coca-Cola 2.25L', quantity: 2, lineTotal: money(360_000) }),
    ]),
  },
] as const;

/** A second Día cart used only to attempt a release against fixture #1. */
const WRONG_CART = cart('dia-evidence-wrong-cart-99', [
  line({ index: 0, skuId: '809999', name: 'Fernet Branca 750ml', quantity: 1, lineTotal: money(980_000) }),
]);

describe('order evidence rule (Día fixture carts)', () => {
  it('decideOrderEvidence: matching confirmed baskets release', async () => {
    for (const f of FIXTURES.filter((x) => x.expect === 'release')) {
      const hash = toHex(await basketHash(f.cart));
      assert.deepEqual(
        decideOrderEvidence({ lockedBasketHash: hash, presentedBasketHash: hash, store: f.store }),
        { action: 'release' },
        f.key,
      );
    }
  });

  it('decideOrderEvidence: failed or expired orders refund', async () => {
    for (const f of FIXTURES.filter((x) => x.expect === 'refund')) {
      const hash = toHex(await basketHash(f.cart));
      assert.deepEqual(
        decideOrderEvidence({ lockedBasketHash: hash, presentedBasketHash: hash, store: f.store }),
        { action: 'refund', reason: f.store },
        f.key,
      );
    }
  });

  it('decideOrderEvidence: a release for a different cart is BasketMismatch', async () => {
    const locked = toHex(await basketHash(FIXTURES[0].cart));
    const wrong = toHex(await basketHash(WRONG_CART));
    assert.notEqual(locked, wrong);
    assert.deepEqual(
      decideOrderEvidence({ lockedBasketHash: locked, presentedBasketHash: wrong, store: 'confirmed' }),
      { action: 'reject', error: 'BasketMismatch' },
    );
  });
});
