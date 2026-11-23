import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cotoCheckoutBlocked } from '../checkout/coto-guard.ts';

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
});
