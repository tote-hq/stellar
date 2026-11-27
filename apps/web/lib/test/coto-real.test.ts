import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { CatalogItem } from '@changuito/mcp/compare';
import type { Product } from '@changuito/mcp/types';

import { emptyCache } from '../agent/render-tools.ts';
import { beginDualSearch } from '../agent/search-compare.ts';
import {
  admitCotoReal,
  av5LogLine,
  COTO_REAL_PHASES,
  cotoRealOutcome,
  cotoShopperBody,
  deliveryBeforeShop,
  freezeAllowed,
  freezeCotoReal,
  HOME_MINIMUM_COPY,
  HOME_PROVISION_CENTAVOS,
  mergeDiaPair,
  quoteBuyerError,
  quoteFromPriced,
  refundAmount,
  resolveCoverage,
  shopperCopy,
  shopperPrompt,
  shopperStatus,
  type DiaPair,
  type PricedLine,
} from '../checkout/coto-real.ts';

const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function dia(sku: string, centavos: number, ean: string): Product {
  return {
    skuId: sku,
    productId: `p-${sku}`,
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean,
    sellerId: '1',
    price: { centavos, display: '$0' },
    available: true,
  };
}

function coto(id: string, centavos: number, ean: string): CatalogItem {
  return {
    id,
    name: 'Leche Protein 1 L',
    brand: 'Serenisima',
    ean,
    shelfPrice: { centavos, display: '$0' },
    priceSource: 'store_200',
    available: true,
  };
}

async function search(
  cache: ReturnType<typeof emptyCache>,
  item: CatalogItem,
  product: Product,
): Promise<void> {
  const run = beginDualSearch({
    id: item.id,
    query: item.name,
    cache,
    emit: () => undefined,
    searcher: { async search() { return [item]; } },
  });
  await run.finish({ products: [product], failed: false });
}

const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  skuId: 'c1',
  name: 'Leche',
  quantity: 2,
  unitCentavos: 247400,
  available: true,
  ...over,
});

describe('coto real quote', () => {
  it('admits only when the global switch and the row flag are both on', () => {
    assert.equal(admitCotoReal({ enabled: true, sandboxEnabled: false }), false);
    assert.equal(admitCotoReal({ enabled: false, sandboxEnabled: true }), false);
    assert.equal(admitCotoReal({ enabled: true, sandboxEnabled: true }), true);
  });

  it('ignores the client total and prices the catalog line plus the matched fee', () => {
    const pairs: DiaPair[] = [{ cotoId: 'c1', diaSkuId: 'd1', diaCentavos: 247500, confidence: 'ean' }];
    const quoted = quoteFromPriced({
      lines: [line()],
      clientTotalCentavos: 1,
      pairs,
      postalCode: '1425',
      coverage: 'table',
      fulfillment: 'pickup',
    });
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.equal(quoted.quote.cotoTicketCentavos, 494800);
    assert.equal(quoted.quote.diaMatchedCentavos, 495000);
    assert.equal(quoted.quote.feeCentavos, 40);
    assert.equal(quoted.quote.lockCentavos, 494840);
    assert.equal(quoted.quote.shippingProvisionCentavos, 0);
    const home = quoteFromPriced({
      lines: [line()],
      clientTotalCentavos: 1,
      pairs,
      postalCode: '1425',
      coverage: 'shopper',
      fulfillment: 'home',
    });
    assert.equal(home.ok, false);
    if (!home.ok) assert.equal(home.error, HOME_MINIMUM_COPY);
    const over = quoteFromPriced({
      lines: [line({ quantity: 1, unitCentavos: 3_000_000 })],
      clientTotalCentavos: 1,
      pairs: [{ cotoId: 'c1', diaSkuId: 'd1', diaCentavos: 3_000_000, confidence: 'ean' }],
      postalCode: '1425',
      coverage: 'shopper',
      fulfillment: 'home',
    });
    assert.equal(over.ok, true);
    if (over.ok) {
      assert.equal(over.quote.shippingProvisionCentavos, HOME_PROVISION_CENTAVOS);
      assert.equal(over.quote.feeCentavos, 0);
      assert.equal(over.quote.lockCentavos, 3_000_000 + HOME_PROVISION_CENTAVOS);
    }
    assert.notEqual(quoted.quote.cotoTicketCentavos, 1);
    const unmatched = quoteFromPriced({
      lines: [line()],
      clientTotalCentavos: 1,
      pairs: [],
      postalCode: '1951',
      coverage: 'shopper',
      fulfillment: 'pickup',
    });
    assert.equal(unmatched.ok, true);
    if (unmatched.ok) {
      assert.equal(unmatched.quote.gapCentavos, 0);
      assert.equal(unmatched.quote.feeCentavos, 0);
      assert.equal(unmatched.quote.lockCentavos, 494800);
    }
  });

  it('uses fee 0 when no pair matches, and rejects an unsafe quantity', () => {
    const none = quoteFromPriced({
      lines: [line()],
      clientTotalCentavos: 1,
      pairs: [],
      postalCode: '1425',
      coverage: 'ops',
      fulfillment: 'pickup',
    });
    assert.equal(none.ok, true);
    if (none.ok) {
      assert.equal(none.quote.feeBasis, 'no_refs');
      assert.equal(none.quote.feeCentavos, 0);
      assert.equal(none.quote.lockCentavos, 494800);
    }
    const huge = quoteFromPriced({
      lines: [line({ quantity: Number.MAX_SAFE_INTEGER })],
      clientTotalCentavos: 1,
      pairs: [],
      postalCode: '1425',
      coverage: 'table',
      fulfillment: 'pickup',
    });
    assert.equal(huge.ok, false);
    const unavailable = quoteFromPriced({
      lines: [line({ available: false })],
      clientTotalCentavos: 1,
      pairs: [],
      postalCode: '1425',
      coverage: 'table',
      fulfillment: 'pickup',
    });
    assert.equal(unavailable.ok, false);
  });

  it('keeps both searches, and a repeated coto id keeps the latest Día sku', async () => {
    const cache = emptyCache();
    await search(cache, coto('c1', 800, '7790001'), dia('d1', 1000, '7790001'));
    await search(cache, coto('c2', 400, '7790002'), dia('d2', 500, '7790002'));
    const frozen = freezeCotoReal(undefined, cache.diaPairs ?? [], OWNER);
    assert.equal(frozen.ok, true);
    if (!frozen.ok) return;
    assert.deepEqual(
      frozen.snapshot.pairs.map((pair) => pair.cotoId),
      ['c1', 'c2'],
    );
    assert.equal(frozen.snapshot.buyer, OWNER);

    const again = emptyCache();
    await search(again, coto('c1', 800, '7790001'), dia('d1', 1000, '7790001'));
    await search(again, coto('c1', 900, '7790001'), dia('d9', 1200, '7790001'));
    assert.equal(again.diaPairs?.length, 1);
    assert.equal(again.diaPairs?.[0]?.diaSkuId, 'd9');
    assert.deepEqual(mergeDiaPair(again.diaPairs ?? [], again.diaPairs![0]!), again.diaPairs);
  });

  it('stamps the owner on a second freeze, and refuses a guest or another wallet', () => {
    const pairs: DiaPair[] = [{ cotoId: 'c1', diaSkuId: 'd1', diaCentavos: 1000, confidence: 'ean' }];
    const guest = freezeCotoReal(undefined, pairs, null);
    assert.equal(guest.ok, true);
    if (!guest.ok) return;
    assert.equal(guest.snapshot.buyer, undefined);
    assert.equal(quoteBuyerError(guest.snapshot, OWNER), 'Confirmá Coto de nuevo con la sesión iniciada.');

    const signed = freezeCotoReal(guest.snapshot, pairs, OWNER);
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    assert.equal(signed.snapshot.buyer, OWNER);
    assert.equal(quoteBuyerError(signed.snapshot, OWNER), undefined);

    assert.equal(freezeAllowed(signed.snapshot, null), false);
    const guestAgain = freezeCotoReal(signed.snapshot, pairs, null);
    assert.equal(guestAgain.ok, false);
    assert.equal(signed.snapshot.buyer, OWNER);

    const other = freezeCotoReal(signed.snapshot, pairs, OTHER);
    assert.equal(other.ok, false);
    assert.equal(quoteBuyerError(signed.snapshot, OTHER), 'Este changuito está asociado a otra cuenta.');
    assert.equal(quoteBuyerError(undefined, OWNER), undefined);
  });

  it('no longer limits Coto pay to the latest card in the turn', () => {
    // cotoPayTarget was removed. Every Coto card uses cotoPayGate, covered in
    // coto-pay-gate.test.ts. An older card pays the live basket.
    const source = readFileSync(join(import.meta.dirname, '../checkout/coto-real.ts'), 'utf8');
    assert.equal(source.includes('cotoPayTarget'), false);
  });

  it('refunds the full lock, hides viewer fields, and keeps delivery before shop', () => {
    assert.equal(refundAmount(494840, 'cancel'), 494840);
    assert.equal(refundAmount(494840, 'needs_human_timeout'), 494840);
    assert.equal(refundAmount(494840, 'needs_shopper_timeout'), 494840);
    assert.equal(shopperCopy('needs_shopper_timeout'), 'No llegamos a completar un dato del pedido. Te devolvemos el saldo.');
    assert.equal(
      shopperCopy('sku_rejected', null, 'Manteca TONADITA 100 g'),
      'No pudimos cargar «Manteca TONADITA 100 g». Te devolvemos el saldo.',
    );
    assert.equal(shopperCopy('sku_rejected'), 'No pudimos cargar un producto. Te devolvemos el saldo.');
    assert.equal(shopperCopy('sku_rejected', null, '   '), 'No pudimos cargar un producto. Te devolvemos el saldo.');
    assert.equal(
      shopperCopy('sku_rejected', 'declined', 'Manteca TONADITA 100 g'),
      'No se pudo cobrar en Coto. Te devolvemos el saldo.',
    );
    assert.equal(refundAmount(494840, 'placed'), undefined);
    const logged: string[] = [];
    const status = shopperStatus({
      phase: 'payment',
      viewerUrl: 'https://sandbox.example/vnc',
      adminViewerUrl: 'https://sandbox.example/admin',
      ticket: 'secret',
      formUrl: 'https://sandbox.example/form',
    });
    logged.push(av5LogLine('https://sandbox.example/vnc'));
    assert.equal(status.viewerUrl, undefined);
    assert.equal(status.adminViewerUrl, undefined);
    assert.equal(status.ticket, undefined);
    assert.equal(status.formUrl, undefined);
    assert.equal(status.phase, 'payment');
    assert.match(logged[0] ?? '', /novnc/);
    assert.equal(JSON.stringify(status).includes('novnc'), false);
    assert.equal(deliveryBeforeShop(COTO_REAL_PHASES), true);
    assert.equal(deliveryBeforeShop(['login', 'shop', 'delivery']), false);
  });

  it('resolves coverage from the ops address, then the table, and not from a street the shopper sent', () => {
    const table = [{ postalCode: '1425', street: 'Calle', city: 'CABA' }];
    const ops = { postalCode: 'C1425ABC', street: 'Ops', city: 'CABA' };
    assert.deepEqual(resolveCoverage('C1425ABC', { ops, table }), { ok: true, coverage: 'ops' });
    assert.deepEqual(resolveCoverage('1425', { ops: null, table }), { ok: true, coverage: 'table' });
    assert.deepEqual(resolveCoverage('9999', { ops: null, table }), { ok: false });
  });

  it('settles only a placed order id and speaks Spanish without a code', () => {
    assert.equal(cotoRealOutcome({ status: 'running', payment: null, storeOrderId: null }), 'wait');
    assert.equal(cotoRealOutcome({ status: 'done', payment: 'placed', storeOrderId: 'C-1' }), 'settle');
    assert.equal(cotoRealOutcome({ status: 'done', payment: 'placed', storeOrderId: '  ' }), 'refund');
    assert.equal(cotoRealOutcome({ status: 'failed', payment: 'declined', storeOrderId: null }), 'refund');
    const copy = shopperCopy('needs_human_timeout');
    assert.equal(copy.includes('phase='), false);
    assert.equal(copy.includes('code='), false);
    assert.equal(copy.includes('http'), false);
    const body = cotoShopperBody(
      { orderId: 'a'.repeat(64), amountCents: 100, storeOrderId: 'C-1', error: copy },
      'refunded',
      null,
    );
    assert.equal(body.phase, null);
    assert.equal(body.handoffUrl, null);
    assert.equal(JSON.stringify(body).includes('http'), false);
    const modal = readFileSync(join(import.meta.dirname, '../../components/CotoRealModal.tsx'), 'utf8');
    assert.equal(modal.includes('<iframe'), false);
    assert.equal(modal.includes('openEscrow'), true);
    assert.equal(modal.includes('PayCard'), false);
    assert.equal(modal.includes('quoteCotoDemo'), false);
  });

  it('shows the checkout prompt only for the order the poll is watching', () => {
    const modal = readFileSync(join(import.meta.dirname, '../../components/CotoRealModal.tsx'), 'utf8');
    const pollGuard = modal.indexOf('if (!orderId || !wallet.address) return;');
    const promptForm = modal.indexOf('data-testid="checkout-prompt"');
    const promptGate = modal.lastIndexOf('{prompt ?', promptForm);
    assert.ok(pollGuard > 0 && pollGuard < promptForm);
    assert.ok(promptGate > pollGuard && promptGate < promptForm);
    const effect = modal.slice(modal.lastIndexOf('useEffect', pollGuard), pollGuard + 600);
    assert.match(effect, /\/api\/checkout\/status\?orderId=\$\{orderId\}/);
  });

  it('drops an empty pickup question and leaves every other prompt unchanged', () => {
    const empty = { label: '¿En qué sucursal retirás?', fieldRef: 'pickup_branch', options: [] as const };
    assert.equal(shopperPrompt({ ...empty, options: [] }), null);
    assert.equal(shopperPrompt({ ...empty, options: null }), null);
    const two = {
      label: '¿En qué sucursal retirás?',
      fieldRef: 'pickup_branch',
      options: [
        { label: 'Villa Crespo', value: 'Villa Crespo', suggested: true },
        { label: 'Abasto', value: 'Abasto' },
      ],
    };
    assert.equal(shopperPrompt(two), two);
    const notes = { label: 'Notas', fieldRef: 'butcher_notes', options: null };
    assert.equal(shopperPrompt(notes), notes);
  });

  it('resumes an open order before a new checkout and clears a prompt the server stops sending', () => {
    const modal = readFileSync(join(import.meta.dirname, '../../components/CotoRealModal.tsx'), 'utf8');
    const resumeAt = modal.indexOf('/api/checkout/coto-real/resume');
    const fulfillmentAt = modal.indexOf('data-testid="checkout-fulfillment"');
    assert.ok(resumeAt !== -1 && fulfillmentAt > resumeAt);
    const lockAt = modal.indexOf('data-testid="coto-real-lock"');
    const gateAt = modal.lastIndexOf("resume === 'fresh'", lockAt);
    assert.ok(gateAt !== -1 && gateAt < lockAt);
    assert.match(modal, /setPrompt\(body\.prompt \?\? null\)/);
    assert.match(modal, /fieldRef === 'pickup_branch'/);
  });

  it('closes a resume-only modal when the order is gone and keeps Pay behind resumeOpen', () => {
    const modal = readFileSync(join(import.meta.dirname, '../../components/CotoRealModal.tsx'), 'utf8');
    assert.match(modal, /resumeOnly \? 'closed'/);
    const freshAt = modal.indexOf("resume === 'fresh'");
    const lockAt = modal.indexOf('data-testid="coto-real-lock"');
    const closedAt = modal.indexOf('data-testid="coto-real-closed"');
    assert.ok(freshAt !== -1 && lockAt > freshAt && closedAt > lockAt);
    const chat = readFileSync(join(import.meta.dirname, '../../components/Chat.tsx'), 'utf8');
    assert.match(chat, /cotoResumeProbe\(/);
    let from = 0;
    for (let n = 0; n < 2; n += 1) {
      const at = chat.indexOf('cotoPayGate(', from);
      assert.ok(at !== -1);
      const slice = chat.slice(at, chat.indexOf('});', at));
      assert.match(slice, /resumeOpen/);
      from = at + 'cotoPayGate('.length;
    }
    assert.equal(chat.indexOf('cotoPayGate(', from), -1);
    const rail = readFileSync(join(import.meta.dirname, '../../components/CartRail.tsx'), 'utf8');
    const railAt = rail.indexOf('cotoPayGate(');
    assert.ok(railAt !== -1);
    assert.match(rail.slice(railAt, rail.indexOf('})', railAt)), /resumeOpen/);
  });

  it('filters the job prompt and the pending prompt before openPrompt', () => {
    const route = readFileSync(join(import.meta.dirname, '../../app/api/checkout/status/route.ts'), 'utf8');
    const job = route.indexOf('shopperPrompt(');
    const pending = route.indexOf('shopperPrompt(', job + 1);
    const open = route.indexOf('openPrompt(');
    assert.ok(job !== -1 && pending > job && job < open);
  });
});
