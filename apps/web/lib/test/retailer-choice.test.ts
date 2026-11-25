import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  choiceMessage,
  confirmSwitchMessage,
  needsSwitchConfirm,
} from '../retailer-choice.ts';

describe('retailer choice', () => {
  it('asks to confirm only when the current basket is the other chain and has lines', () => {
    assert.equal(needsSwitchConfirm(null, 'coto'), false);
    assert.equal(needsSwitchConfirm({ retailer: 'dia', lines: 0 }, 'coto'), false);
    assert.equal(needsSwitchConfirm({ retailer: 'dia', lines: 2 }, 'dia'), false);
    assert.equal(needsSwitchConfirm({ retailer: 'dia', lines: 2 }, 'coto'), true);
    assert.equal(needsSwitchConfirm({ retailer: 'jumbo', lines: 2 }, 'coto'), false);
  });

  it('cancel sends nothing; confirm names the destination', () => {
    assert.match(choiceMessage('dia'), /Día/);
    assert.match(choiceMessage('coto'), /Coto/);
    assert.doesNotMatch(choiceMessage('coto'), /Día/);
    const confirm = confirmSwitchMessage('dia', 'coto');
    assert.match(confirm, /Coto/);
    assert.match(confirm, /Día/);
  });
});
