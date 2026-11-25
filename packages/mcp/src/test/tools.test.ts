import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Escalation } from '../checkout/types.js';
import type { AppConfig } from '../config.js';
import { ConfigError } from '../config.js';
import {
  assertCheckoutSupported,
  explain,
  postalCodeNote,
  toDeliveryAddress,
  type AddressInput,
} from '../tools.js';
import { parseARS } from '../util/money.js';

const addr = (over: Partial<AddressInput> = {}): AddressInput => ({
  street: 'Av. Corrientes',
  number: '1234',
  postal_code: '1425',
  ...over,
});

describe('toDeliveryAddress', () => {
  it('refuses a postal code the store would reject anyway', () => {
    assert.throws(() => toDeliveryAddress(addr({ postal_code: '142' })), /not an Argentine postal code/);
    assert.throws(() => toDeliveryAddress(addr({ postal_code: '14255' })), /not an Argentine postal code/);
    assert.throws(() => toDeliveryAddress(addr({ postal_code: 'SW1A 1AA' })), /not an Argentine postal code/);
  });

  it('requires a street and a number', () => {
    assert.throws(() => toDeliveryAddress(addr({ street: '  ' })), /street name is required/);
    assert.throws(() => toDeliveryAddress(addr({ number: '' })), /street number is required/);
  });

  it('RULE: never asks for a name or a DNI — those come from the store profile', () => {
    const a = toDeliveryAddress(addr({ receiver_name: 'Someone Else' })) as unknown as Record<string, unknown>;
    // receiverName is who takes delivery, not who the account holder is.
    assert.equal(a.receiverName, 'Someone Else');
    assert.ok(!('document' in a));
    assert.ok(!('dni' in a));
    assert.ok(!('firstName' in a));
  });
});

describe('postalCodeNote', () => {
  it('warns when the delivery area differs from the priced area', () => {
    const note = postalCodeNote(toDeliveryAddress(addr({ postal_code: '5000' })), '1425');
    assert.match(note ?? '', /1425/);
    assert.match(note ?? '', /5000/);
    assert.match(note ?? '', /review_order/);
  });
});

describe('assertCheckoutSupported', () => {
  const cfg = (retailer: string): AppConfig => ({ retailer, host: `${retailer}.test` }) as AppConfig;

  it('allows Día', () => {
    assert.doesNotThrow(() => assertCheckoutSupported(cfg('dia')));
  });

  it('refuses the read-only stores, and says what still works', () => {
    assert.throws(() => assertCheckoutSupported(cfg('jumbo')), /Checkout is implemented for Día only/);
    assert.throws(() => assertCheckoutSupported(cfg('carrefour')), /Search and cart building work/);
  });
});

describe('explain', () => {
  it('renders an escalation in full — it is a question, not a crash', () => {
    const e = new Escalation(
      'I do not recognise this screen.',
      { state: 'unknown', confidence: 0, layer: 'escalation', why: 'no match' },
      '/tmp/shot.png',
      'URL: https://x.test/',
    );
    const out = explain(e);
    assert.match(out, /do not recognise/);
    assert.match(out, /URL: https:\/\/x\.test/);
    assert.match(out, /Screenshot: \/tmp\/shot\.png/);
  });

  it('points a misconfiguration at the setup guide', () => {
    assert.match(explain(new ConfigError('RPC_URL', 'RPC_URL is not set.')), /SETUP\.md/);
  });

  it('passes ordinary errors through unchanged', () => {
    assert.equal(explain(new Error('boom')), 'boom');
    assert.equal(explain('boom'), 'boom');
  });
});

describe('parseARS — the approval gate input', () => {
  it('refuses anything it cannot read, rather than guessing a number', () => {
    assert.throws(() => parseARS('twelve'), /not an amount I can read/);
    assert.throws(() => parseARS(''), /not an amount I can read/);
    assert.throws(() => parseARS('12 pesos'), /not an amount I can read/);
  });

  it('round-trips the exact total the review showed', () => {
    for (const centavos of [1, 99, 100, 123_456, 9_999_999]) {
      const shown = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2,
      }).format(centavos / 100);
      assert.equal(parseARS(shown), centavos, `failed round trip for ${shown}`);
    }
  });
});
