import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cotoCheckoutBlocked, cotoDemoPayRecord, cotoRealRecord, settleBasis } from '../checkout/coto-guard.ts';

const web = join(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('cotoCheckoutBlocked', () => {
  it('rejects only a coto retailer', () => {
    assert.equal(cotoCheckoutBlocked('coto'), true);
    assert.equal(cotoCheckoutBlocked('dia'), false);
    assert.equal(cotoCheckoutBlocked('jumbo'), false);
    assert.equal(cotoCheckoutBlocked('disco'), false);
    assert.equal(cotoCheckoutBlocked('carrefour'), false);
    assert.equal(cotoCheckoutBlocked(undefined), false);
    assert.equal(cotoCheckoutBlocked(null), false);
  });

  it('runs before a quote, a job, an open signature, or a channels submit', () => {
    const quote = read('app/api/checkout/quote/route.ts');
    const start = read('app/api/checkout/start/route.ts');
    const open = read('app/api/checkout/open/route.ts');
    const channels = read('app/api/checkout/channels/route.ts');
    const before = (source: string, earlier: string, later: string) => {
      const at = source.indexOf(earlier);
      const next = source.indexOf(later);
      assert.ok(at !== -1 && next !== -1 && at < next, `${earlier} before ${later}`);
    };
    before(quote, 'cotoCheckoutBlocked(cart.retailer)', 'compareDiaToCoto(');
    before(quote, 'cotoCheckoutBlocked(cart.retailer)', 'checkoutStore().set');
    before(start, 'cotoCheckoutBlocked(rec.retailer)', 'startJob(');
    before(start, 'cotoCheckoutBlocked(rec.retailer)', 'readOrder(');
    before(open, 'cotoCheckoutBlocked(got.rec.retailer)', 'recoverOpenAttempt(');
    before(open, 'cotoCheckoutBlocked(got.rec.retailer)', 'rec.openSig = openSig');
    before(channels, 'cotoCheckoutBlocked(rec.retailer)', 'prepareOpen(');
    before(channels, 'cotoCheckoutBlocked(rec.retailer)', 'submitOpen(');
    assert.match(channels, /\[checkout\/channels\] record/);
    for (const source of [quote, start, open, channels]) {
      assert.equal(source.includes('carrito de Coto'), false);
      assert.equal(source.includes('Coto cart'), false);
    }
  });

  it('lets a stored mock Coto record through and prices it from the catalog', () => {
    assert.equal(cotoDemoPayRecord({ retailer: 'coto', mode: 'mock' }), true);
    assert.equal(cotoDemoPayRecord({ retailer: 'coto', mode: 'mock', checkoutKind: 'manual_fee_v1' }), false);
    assert.equal(cotoDemoPayRecord({ retailer: 'coto', mode: 'mock', checkoutKind: 'coto_real_v1' }), false);
    assert.equal(cotoRealRecord({ checkoutKind: 'coto_real_v1' }), true);
    assert.equal(cotoRealRecord({ checkoutKind: 'manual_fee_v1' }), false);
    assert.equal(cotoDemoPayRecord({ retailer: 'coto', mode: 'demo' }), false);
    assert.equal(cotoDemoPayRecord({ retailer: 'dia', mode: 'mock' }), false);
    assert.equal(cotoDemoPayRecord(null), false);
    const quote = read('app/api/checkout/quote/route.ts');
    const guard = quote.indexOf('cotoCheckoutBlocked(cart.retailer)');
    const pay = quote.indexOf("payRetailer === 'coto'");
    assert.ok(guard !== -1 && pay > guard);
    assert.match(quote, /retailer: 'coto'/);
    assert.match(quote, /handoffUrl: null/);
    assert.match(quote, /mode: 'mock'/);
    assert.equal(quote.includes('dualCompare'), false);
    const start = read('app/api/checkout/start/route.ts');
    assert.match(start, /cotoDemoPayRecord\(rec\)/);
    assert.match(start, /\{ mock: true, mockFail: flags\.mockFail \}/);
    const status = read('app/api/checkout/status/route.ts');
    assert.match(status, /settleBasis\(rec\)/);
    assert.match(status, /if \(!cotoDemoPayRecord\(rec\)\) rec\.storeOrderForm/);
    assert.equal(settleBasis({ retailer: 'coto', mode: 'mock' }), 'basis|demo-coto-simulated');
    assert.equal(
      settleBasis({ retailer: 'coto', mode: 'mock', checkoutKind: 'coto_real_v1' }),
      'basis|coto-real-not-placed',
    );
    assert.equal(
      settleBasis({ checkoutKind: 'coto_real_v1', storeOrderId: 'C-100' }),
      'basis|coto-real-placed',
    );
    const realStart = read('lib/checkout/coto-real-start.ts');
    assert.equal(realStart.includes('startJob'), false);
    assert.equal(realStart.includes('getProfile'), false);
    assert.equal(realStart.includes('password'), false);
    assert.equal(realStart.includes('loadSharedCard'), false);
    assert.equal(realStart.includes('shared_card'), false);
    const open = read('app/api/checkout/open/route.ts');
    const channels = read('app/api/checkout/channels/route.ts');
    const earlier = (source: string, left: string, right: string) => {
      assert.ok(source.indexOf(left) !== -1 && source.indexOf(left) < source.indexOf(right));
    };
    earlier(start, 'cotoRealRecord(rec)', 'startJob(');
    earlier(open, 'cotoRealRecord(got.rec)', 'recoverOpenAttempt(');
    earlier(channels, 'cotoRealRecord(rec)', 'prepareOpen(');
    assert.equal(settleBasis({ retailer: 'dia', mode: 'mock' }), 'basis|sandbox-order-placed');
    assert.equal(settleBasis({ retailer: 'dia', mode: 'demo' }), 'basis|demo-reached-payment');
    assert.equal(settleBasis({ retailer: 'dia' }), 'basis|sandbox-order-placed');
  });

  it('does not render the Día account on a Coto quote', () => {
    const modal = read('components/CheckoutModal.tsx');
    const review = modal.slice(
      modal.indexOf('data-testid="checkout-lock-step"'),
      modal.indexOf('data-testid="checkout-shopping-step"'),
    );
    const guard = review.indexOf('cotoPay ? null : demo ?');
    const profile = review.indexOf('data-testid="checkout-dia-profile"');
    const fields = review.indexOf('data-testid="checkout-dia"');
    assert.ok(guard !== -1, 'a Coto quote skips the Día account branch');
    assert.ok(profile > guard, 'the saved Día account stays behind the Coto guard');
    assert.ok(fields > profile, 'the Día credential form stays behind the Coto guard');
    assert.match(review, /checkout-password/);
    assert.match(review, /copy\.dniLabel/);
    assert.match(review, /copy\.profileOther/);
  });
});
