import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCartMessage,
  choiceMessage,
  confirmSwitchMessage,
  isBuildCartMessage,
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
    assert.equal(choiceMessage('dia'), 'Quiero seguir en Día.');
    assert.equal(choiceMessage('coto'), 'Quiero seguir en Coto.');
    assert.doesNotMatch(choiceMessage('coto'), /Día/);
    assert.equal(
      buildCartMessage('dia'),
      'Armá el carrito de Día con lo que charlamos y mostrame el pedido listo para pagar.',
    );
    assert.equal(
      buildCartMessage('coto'),
      'Armá el carrito de Coto con lo que charlamos y mostrame el pedido listo para pagar.',
    );
    const confirm = confirmSwitchMessage('dia', 'coto');
    assert.match(confirm, /Coto/);
    assert.match(confirm, /Día/);
  });

  it('recognises a build-cart sentence and not a chain choice or a later search', () => {
    assert.equal(isBuildCartMessage(buildCartMessage('dia')), true);
    assert.equal(isBuildCartMessage(`  ${buildCartMessage('coto')}  `), true);
    assert.equal(
      isBuildCartMessage('Armá el carrito con lo que charlamos y mostrame el pedido listo para pagar.'),
      true,
    );
    assert.equal(
      isBuildCartMessage('Build the cart from what we discussed and show me the order ready to pay.'),
      true,
    );
    assert.equal(isBuildCartMessage('Quiero seguir en Coto.'), false);
    assert.equal(isBuildCartMessage('mostrame más arroz'), false);
  });
});
