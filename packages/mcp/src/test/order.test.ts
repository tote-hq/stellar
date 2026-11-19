import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  advance,
  atLeast,
  checkApproval,
  checkTransition,
  invalidateApprovals,
  OrderStateError,
  REQUIRES,
  resetOrder,
  STAGES,
  type OrderDraft,
} from '../order.js';

const at = (stage: OrderDraft['stage'], over: Partial<OrderDraft> = {}): OrderDraft => ({ stage, ...over });

const READY = {
  status: 'ready' as const,
  requiredUsdCents: 2_350,
  bareUsdCents: 2_040,
  arsTotal: 2_040_000,
  arsPerUsd: 1_000,
  buffer: 0.15,
  settledUsdCents: 5_000,
  pendingUsdCents: 0,
  remainingUsdCents: 2_650,
  raisedToCardMinimum: false,
};

beforeEach(() => resetOrder());

describe('the stage ladder', () => {
  it('is ordered, and a later stage implies every earlier one', () => {
    assert.equal(atLeast('reviewed', 'cart_built'), true);
    assert.equal(atLeast('cart_built', 'reviewed'), false);
    assert.equal(atLeast('linked', 'linked'), true);
  });

  it('never moves backwards', () => {
    const d = at('reviewed');
    assert.equal(advance(d, 'cart_built').stage, 'reviewed');
    assert.equal(advance(d, 'funds_checked').stage, 'funds_checked');
  });
});

describe('RULE: no tool can skip an approval gate', () => {
  it('rejects EVERY illegal transition, not just the obvious ones', () => {
    const illegal: Array<[string, OrderDraft['stage']]> = [];
    for (const [tool, needed] of Object.entries(REQUIRES)) {
      for (const stage of STAGES) {
        if (atLeast(stage, needed) || stage === 'order_placed') continue;
        illegal.push([tool, stage]);
        assert.throws(() => checkTransition(tool, at(stage)), OrderStateError, `${tool} from ${stage}`);
      }
    }
    assert.ok(illegal.length >= 10, `covered ${illegal.length} illegal combinations`);
    // A placed order is illegal for a different reason: the store already accepted it.
    assert.throws(() => checkTransition('approve_payment', at('order_placed')), /already been placed/);
    assert.throws(() => checkTransition('build_cart', at('order_placed')), /already been placed/);
    checkTransition('review_order', at('order_placed'));
  });
});

describe('the approval gate', () => {
  const draft = at('funds_checked', { totalCentavos: 2_040_000, plan: READY });

  it('accepts the exact total', () => {
    checkApproval(draft, 2_040_000);
  });

  it('rejects a total that is off by one centavo', () => {
    assert.throws(() => checkApproval(draft, 2_040_001), /Nothing was paid/);
  });

  it('refuses to pay when the funding check did not say ready', () => {
    const short = at('funds_checked', {
      totalCentavos: 2_040_000,
      plan: { ...READY, status: 'short', shortfallUsdCents: 500 } as never,
    });
    assert.throws(() => checkApproval(short, 2_040_000), /replenish_wallet/);
  });

  it('refuses when no funding check has been run at all', () => {
    assert.throws(
      () => checkApproval(at('funds_checked', { totalCentavos: 2_040_000 }), 2_040_000),
      /not 'ready'/,
    );
  });
});

describe('changing the cart invalidates what was approved about it', () => {
  it('drops the reviewed total and the funding plan', () => {
    const after = invalidateApprovals(at('funds_checked', { totalCentavos: 2_040_000, plan: READY }));
    assert.equal(after.stage, 'cart_built');
    assert.equal(after.totalCentavos, undefined);
    assert.equal(after.plan, undefined);
  });

  it('means a user can never approve one basket and pay for another', () => {
    const changed = invalidateApprovals(at('funds_checked', { totalCentavos: 2_040_000, plan: READY }));
    assert.throws(() => checkTransition('approve_payment', changed), /needs 'funds_checked'/);
  });
});
