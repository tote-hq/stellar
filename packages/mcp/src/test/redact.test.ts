import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  forgetAllSecrets,
  looksLikeCardNumber,
  redact,
  redactToString,
  registerSecret,
} from '../secure/redact.js';

afterEach(() => forgetAllSecrets());

/** Luhn-valid test numbers from the public card-network test ranges. */
const VISA_16 = '4111111111111111';
const MC_16 = '5555555555554444';
const AMEX_15 = '378282246310005';
const DINERS_14 = '30569309025904';
const VISA_13 = '4222222222222';
const VISA_19 = '4111111111111111110';

describe('looksLikeCardNumber', () => {
  it('accepts real-shaped PANs of every permitted length', () => {
    // Digits-only form. Spaced and dashed spellings are the same check.
    for (const pan of [VISA_13, DINERS_14, AMEX_15, VISA_16, MC_16, VISA_19]) {
      assert.equal(looksLikeCardNumber(pan), true, pan);
    }
  });

  it('rejects runs that are the right length but fail Luhn', () => {
    assert.equal(looksLikeCardNumber('4111111111111112'), false);
  });

  it('rejects things that are too short or too long', () => {
    assert.equal(looksLikeCardNumber('411111111111'), false);
    assert.equal(looksLikeCardNumber('41111111111111111111'), false);
  });
});

describe('heuristic redaction', () => {
  it('masks a PAN but keeps the last four', () => {
    const out = redactToString(`paying with ${VISA_16} now`);
    assert.ok(!out.includes(VISA_16));
    assert.ok(out.includes('****1111'), out);
  });

  it('masks a bearer token', () => {
    assert.ok(!redactToString('Authorization: Bearer abcdef1234567890').includes('abcdef1234567890'));
  });
});

describe('false positives — the reason Luhn is in here', () => {
  it('leaves a cart total in centavos alone', () => {
    // 1527177 centavos == $15.271,77 — a real Disco cart value from the probes.
    assert.equal(redactToString('total 1527177'), 'total 1527177');
  });
});

describe('exact-match registration', () => {
  it('masks a registered CVV or OTP, which is far too short for any heuristic', () => {
    registerSecret('7321', 'cvv');
    assert.ok(!redactToString('cvv 7321').includes('7321'));
    registerSecret('884213', 'otp');
    assert.ok(!redactToString('otp 884213').includes('884213'));
  });

  it('ignores values under 4 characters, which would shred every log', () => {
    registerSecret('1', 'oops');
    assert.equal(redactToString('item 1 of 10'), 'item 1 of 10');
  });
});

describe('key-aware redaction', () => {
  it('masks DNI by key, because 7-8 digit numbers are also prices', () => {
    const out = redact({ document: '34567890', total: 1527177 });
    assert.equal(out.document, '[REDACTED]');
    assert.equal(out.total, 1527177, 'a centavos total must survive');
  });

  it('masks card, cookie, passphrase and api-key fields wholesale', () => {
    const out = redact({
      cardNumber: VISA_16,
      cvv: '123',
      otp: '884213',
      cookie: 'VtexIdclientAutCookie=abc',
      passphrase: 'correct horse battery staple',
      sku: '392452',
      API_KEY: 'x',
      private_key: 'y',
      SecurityCode: 'z',
    });
    assert.equal(out.cardNumber, '[REDACTED]');
    assert.equal(out.cvv, '[REDACTED]');
    assert.equal(out.otp, '[REDACTED]');
    assert.equal(out.cookie, '[REDACTED]');
    assert.equal(out.passphrase, '[REDACTED]');
    assert.equal(out.sku, '392452');
    assert.equal(out.API_KEY, '[REDACTED]');
    assert.equal(out.private_key, '[REDACTED]');
    assert.equal(out.SecurityCode, '[REDACTED]');
  });
});

describe('structural safety', () => {
  it('recurses into nested objects and arrays', () => {
    const out = redact({ a: [{ b: { cvv: '999', pan: VISA_16 } }] });
    assert.equal(out.a[0].b.cvv, '[REDACTED]');
    assert.equal(out.a[0].b.pan, '[REDACTED]');
  });

  it('never throws, whatever it is handed', () => {
    for (const v of [undefined, null, NaN, Symbol('s'), 10n, () => 1, new Map([['cvv', '1']])]) {
      assert.doesNotThrow(() => redactToString(v));
    }
  });
});
