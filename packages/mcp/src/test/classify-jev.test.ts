import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ask, classifyWithJev, vetoPaymentScreen } from '../checkout/classify/jev.js';
import { emptyPageState } from '../checkout/pagestate.js';
import { loadConfig } from '../config.js';

const ON = loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/s', TYPESAFE_API_KEY: 'ts_key_123' });
const OFF = loadConfig({ VYRION_API_KEY: 'sk_test_x', SECRETS_DIR: '/tmp/s' });

function stubFetch(result: { status?: number; body?: unknown; throws?: Error }) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (result.throws) throw result.throws;
    sent.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const answer = (choice: string, confidence: number, extra: Record<string, unknown> = {}) => ({
  answers: { page: { choice, confidence }, ...extra },
});

const UNKNOWN_SCREEN = emptyPageState({
  url: 'https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=abc#/shipping',
  headings: ['Necesitamos un dato más'],
  buttons: ['Continuar'],
});

const PAY = emptyPageState({
  headings: ['Pagá tu compra'],
  fields: [{ label: 'Número de tarjeta', type: 'text', required: true, filled: false }],
});

describe('classifyWithJev', () => {
  it('returns nothing at all when Jev is disabled, without calling anything', async () => {
    const { fetchImpl, sent } = stubFetch({ body: answer('address_confirm', 0.99) });
    assert.equal(await classifyWithJev(OFF, UNKNOWN_SCREEN, { fetchImpl }), undefined);
    assert.equal(sent.length, 0);
    assert.equal((await vetoPaymentScreen(OFF, PAY)).safe, true);
    await assert.rejects(ask(OFF, {}, {}), /disabled/);
  });

  it('accepts a confident answer from the allowed set', async () => {
    const { fetchImpl } = stubFetch({ body: answer('address_confirm', 0.91) });
    const v = await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl });
    assert.equal(v?.state, 'address_confirm');
    assert.equal(v?.layer, 'jev');
    assert.equal(v?.confidence, 0.91);
  });

  it('FAILS CLOSED below the confidence floor', async () => {
    const bodies: unknown[] = [
      answer('payment_form', 0.74),
      answer('transfer_all_funds', 1),
      answer('unknown', 0.99),
      { answers: { page: { choice: 'payment_form' } } },
    ];
    for (const body of bodies) {
      const { fetchImpl } = stubFetch({ body });
      assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
    }
  });

  it('FAILS CLOSED on a network error rather than retrying into a money path', async () => {
    const failures: Array<{ status?: number; body?: unknown; throws?: Error }> = [
      { throws: new Error('ECONNRESET') },
      { status: 500 },
      { body: { nonsense: true } },
    ];
    for (const result of failures) {
      const { fetchImpl } = stubFetch(result);
      assert.equal(await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl }), undefined);
    }
  });

  it('carries the 3DS presentation back when it names one', async () => {
    const { fetchImpl } = stubFetch({
      body: answer('threeds', 0.95, { threeds_kind: { choice: 'iframe', confidence: 0.9 } }),
    });
    const v = await classifyWithJev(ON, UNKNOWN_SCREEN, { fetchImpl });
    assert.equal(v?.threeDsKind, 'iframe');
  });
});

describe('vetoPaymentScreen — it can stop a payment, never authorise one', () => {
  it('allows the payment when Jev sees nothing wrong', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { safe_to_pay: { choice: 'looks_normal', confidence: 0.96 } } } });
    assert.equal((await vetoPaymentScreen(ON, PAY, { fetchImpl })).safe, true);
  });

  it('BLOCKS the payment when Jev flags the screen', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { safe_to_pay: { choice: 'something_wrong', confidence: 0.9 } } } });
    const r = await vetoPaymentScreen(ON, PAY, { fetchImpl });
    assert.equal(r.safe, false);
    assert.match(r.why, /flagged/);
  });

  it('BLOCKS when Jev is unsure — an unsure classifier is not an approval', async () => {
    const { fetchImpl } = stubFetch({ body: { answers: { safe_to_pay: { choice: 'looks_normal', confidence: 0.4 } } } });
    assert.equal((await vetoPaymentScreen(ON, PAY, { fetchImpl })).safe, false);

    const down = stubFetch({ throws: new Error('timeout') });
    const r = await vetoPaymentScreen(ON, PAY, { fetchImpl: down.fetchImpl });
    assert.equal(r.safe, false);
    assert.match(r.why, /unreachable/);
  });
});
