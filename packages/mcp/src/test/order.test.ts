import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  advance,
  atLeast,
  checkTransition,
  invalidateApprovals,
  OrderStateError,
  REQUIRES,
  resetOrder,
  STAGES,
  type OrderDraft,
} from '../order.js';

const at = (stage: OrderDraft['stage'], over: Partial<OrderDraft> = {}): OrderDraft => ({ stage, ...over });

beforeEach(() => resetOrder());

describe('the stage ladder', () => {
  it('is ordered, and a later stage implies every earlier one', () => {
    assert.equal(atLeast('reviewed', 'cart_built'), true);
    assert.equal(atLeast('cart_built', 'reviewed'), false);
    assert.equal(atLeast('linked', 'linked'), true);
  });

  it('stops at reviewed', () => {
    assert.equal(STAGES[STAGES.length - 1], 'reviewed');
  });

  it('never moves backwards', () => {
    const d = at('reviewed');
    assert.equal(advance(d, 'cart_built').stage, 'reviewed');
    assert.equal(advance(d, 'reviewed').stage, 'reviewed');
  });
});

describe('RULE: no tool can skip a step', () => {
  it('rejects EVERY illegal transition, not just the obvious ones', () => {
    const illegal: Array<[string, OrderDraft['stage']]> = [];
    for (const [tool, needed] of Object.entries(REQUIRES)) {
      for (const stage of STAGES) {
        if (atLeast(stage, needed)) continue;
        illegal.push([tool, stage]);
        assert.throws(() => checkTransition(tool, at(stage)), OrderStateError, `${tool} from ${stage}`);
      }
    }
    assert.ok(illegal.length >= 6, `covered ${illegal.length} illegal combinations`);
    checkTransition('review_order', at('cart_built'));
    checkTransition('review_order', at('reviewed'));
  });
});

describe('changing the cart invalidates the total that was shown', () => {
  it('drops the reviewed total', () => {
    const after = invalidateApprovals(at('reviewed', { totalCentavos: 2_040_000 }));
    assert.equal(after.stage, 'cart_built');
    assert.equal(after.totalCentavos, undefined);
  });

  it('leaves review_order as the next legal step, with no total attached', () => {
    const changed = invalidateApprovals(at('reviewed', { totalCentavos: 2_040_000 }));
    assert.equal(changed.totalCentavos, undefined);
    assert.doesNotThrow(() => checkTransition('review_order', changed));
  });
});
