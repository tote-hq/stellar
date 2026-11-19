import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  emitAnalytics,
  errorCode,
  flushAnalytics,
  readAnalyticsIds,
  sanitizeProps,
  track,
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

test('track waits for consent and PostHog only receives sanitized props', () => {
  const ids = readAnalyticsIds({
    ga: 'G-TEST1234',
    meta: '1234567890',
    clarity: 'abc123def',
    posthog: 'phc_test',
  });
  const ga: string[] = [];
  const meta: string[] = [];
  const clarity: string[] = [];
  const posthog: Array<{ event: string; props?: Record<string, unknown> }> = [];
  const sink: AnalyticsSink = {
    gtag: (_command, name) => {
      ga.push(name);
    },
    fbq: (_command, name) => {
      meta.push(name);
    },
    clarity: (_command, name) => {
      clarity.push(name);
    },
    posthog: (event, props) => {
      posthog.push({ event, props });
    },
  };
  const props = {
    flow: 'faucet',
    ref: `G${'A'.repeat(55)}`,
    address: `G${'B'.repeat(55)}`,
    amount: 12,
    email: 'a@b.c',
    dni: '30111222',
    token: 'secret',
    message: 'hola',
    text: 'hola',
  };
  const g = globalThis as { window?: object; document?: { cookie: string } };
  const previousWindow = g.window;
  const previousDocument = g.document;
  try {
    g.window = {};
    g.document = { cookie: '' };
    track('search_submit', props, ids, sink);
    g.document.cookie = 'chg_consent=denied';
    track('search_submit', props, ids, sink);
    g.document.cookie = 'chg_consent=granted';
    flushAnalytics(ids, sink);
    assert.deepEqual(ga, []);
    assert.deepEqual(meta, []);
    assert.deepEqual(clarity, []);
    assert.deepEqual(posthog, []);

    track('search_submit', props, ids, sink);
    assert.deepEqual(ga, ['search_submit']);
    assert.deepEqual(meta, ['Search']);
    assert.deepEqual(clarity, ['search_submit']);
    assert.deepEqual(posthog, [{ event: 'search_submit', props: { flow: 'faucet' } }]);
  } finally {
    if (previousWindow === undefined) delete g.window;
    else g.window = previousWindow;
    if (previousDocument === undefined) delete g.document;
    else g.document = previousDocument;
  }
});
