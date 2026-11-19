import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  emitAnalytics,
  errorCode,
  readAnalyticsIds,
  sanitizeProps,
  type AnalyticsSink,
} from '../analytics.ts';

const ids = readAnalyticsIds({
  ga: 'G-TEST1234',
  meta: '1234567890',
  clarity: 'abc123def',
});

test('product events use Meta standard names and a known error becomes one code', () => {
  const meta: string[] = [];
  const ga: string[] = [];
  const sink: AnalyticsSink = {
    gtag: (_command, name) => {
      ga.push(name);
    },
    fbq: (command, name) => {
      meta.push(`${command}:${name}`);
    },
    clarity: () => {},
  };
  emitAnalytics('search_submit', undefined, ids, sink);
  emitAnalytics('payment_success', { flow: 'checkout' }, ids, sink);
  emitAnalytics('login_success', undefined, ids, sink);
  emitAnalytics('session_start', undefined, ids, sink);
  assert.deepEqual(ga, ['search_submit', 'payment_success', 'login_success', 'session_start']);
  assert.deepEqual(meta, [
    'track:Search',
    'track:Purchase',
    'trackCustom:login_success',
    'trackCustom:session_start',
  ]);
  assert.equal(meta.some((name) => name.includes('CompleteRegistration')), false);
  assert.equal(errorCode('Ollama tardó demasiado en arrancar. Esperá.'), 'local_model');
});

test('props stay coarse', () => {
  assert.deepEqual(
    sanitizeProps({
      code: 'local_model',
      flow: 'faucet',
      email: 'a@b.c',
      message: 'hola',
      amount: 50,
      name: 'Ana',
      note: 'a long free text note that must not be sent anywhere',
    }),
    { code: 'local_model', flow: 'faucet' },
  );
  assert.equal(sanitizeProps({ message: 'secret' }), undefined);
});
