import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { POSTHOG_PROXY_PATH } from '../posthog-path.ts';
import {
  applyPostHogConsent,
  identifyWallet,
  initOptions,
  initPostHog,
  resetPostHog,
  type PostHogClient,
  type PostHogInitOptions,
} from '../posthog.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
const ADDRESS = `G${'A'.repeat(55)}`;

type CookieHost = { document?: { cookie: string } };

function withCookie(cookie: string, run: () => void): void {
  const host = globalThis as CookieHost;
  const previous = host.document;
  host.document = { cookie };
  try {
    run();
  } finally {
    if (previous === undefined) delete host.document;
    else host.document = previous;
  }
}

function standIn(calls: string[]): PostHogClient {
  return {
    init() {
      calls.push('init');
    },
    opt_in_capturing() {
      calls.push('opt_in');
    },
    opt_out_capturing() {
      calls.push('opt_out');
    },
    startSessionRecording() {
      calls.push('record');
    },
    identify(id: string) {
      calls.push(`id:${id}`);
    },
    reset() {
      calls.push('reset');
    },
    capture() {},
  };
}

describe('posthog client', { concurrency: 1 }, () => {
  test('an empty key does nothing, and a set key identifies only a uuid', () => {
    const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const calls: string[] = [];
    const client = {
      init(key: string, options: { api_host?: string }) {
        calls.push(`init:${key}:${options.api_host ?? ''}`);
      },
      opt_in_capturing() {},
      opt_out_capturing() {},
      identify(id: string) {
        calls.push(`id:${id}`);
      },
      reset() {},
      startSessionRecording() {},
      capture() {},
    } satisfies PostHogClient;

    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    initPostHog(client);
    identifyWallet(UUID);
    identifyWallet(ADDRESS);
    assert.equal(calls.length, 0);

    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    const host = globalThis as CookieHost;
    const previousDocument = host.document;
    host.document = { cookie: 'chg_consent=granted' };
    let options: PostHogInitOptions | undefined;
    const live: PostHogClient = {
      init(_key, opts) {
        options = opts;
      },
      opt_in_capturing() {},
      opt_out_capturing() {},
      startSessionRecording() {},
      identify(id: string) {
        calls.push(`id:${id}`);
      },
      reset() {},
      capture() {},
    };
    initPostHog(live);
    assert.equal(options?.opt_out_capturing_by_default, true);
    assert.equal(options?.disable_session_recording, true);
    assert.equal(options?.autocapture, false);
    assert.equal(options?.capture_pageview, false);
    assert.equal(options?.capture_pageleave, false);
    assert.equal(options?.persistence, 'localStorage+cookie');
    assert.equal(options?.disable_surveys, true);
    assert.equal(options?.api_host, POSTHOG_PROXY_PATH);
    assert.equal(options?.ui_host, 'https://us.posthog.com');
    const recording = options?.session_recording;
    assert.ok(recording);
    assert.equal(recording.maskAllInputs, true);
    assert.equal(recording.maskTextSelector, '*');
    assert.equal(recording.blockSelector, '.ph-no-capture');

    identifyWallet(ADDRESS);
    identifyWallet(UUID);
    assert.deepEqual(calls, [`id:${UUID}`]);

    if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
    if (previousDocument === undefined) delete host.document;
    else host.document = previousDocument;
  });

  test('init waits until consent is granted', () => {
    const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    resetPostHog();
    try {
      for (const cookie of ['', 'chg_consent=denied']) {
        const calls: string[] = [];
        withCookie(cookie, () => initPostHog(standIn(calls)));
        assert.deepEqual(calls, [], cookie || 'unset');
      }
      const calls: string[] = [];
      withCookie('chg_consent=granted', () => initPostHog(standIn(calls)));
      assert.deepEqual(calls, ['init']);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
      else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
    }
  });

  test('logout reset opts back in while consent stays granted', () => {
    const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    const calls: string[] = [];
    try {
      withCookie('chg_consent=granted', () => {
        initPostHog(standIn(calls));
        calls.length = 0;
        resetPostHog();
      });
      assert.deepEqual(calls, ['reset', 'opt_in', 'record']);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
      else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
    }
  });

  test('applyPostHogConsent inits only when the choice is granted', () => {
    const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    const calls: string[] = [];
    const seen: PostHogInitOptions[] = [];
    const client: PostHogClient = {
      init(_key, options) {
        seen.push(options);
        calls.push('init');
      },
      opt_in_capturing() {
        calls.push('opt_in');
      },
      opt_out_capturing() {
        calls.push('opt_out');
      },
      startSessionRecording() {
        calls.push('record');
      },
      identify() {},
      reset() {},
      capture() {},
    };
    try {
      applyPostHogConsent(null, client);
      applyPostHogConsent('denied', client);
      assert.deepEqual(calls, []);

      // init still refuses until the banner cookie is granted.
      withCookie('chg_consent=granted', () => {
        applyPostHogConsent('granted', client);
        applyPostHogConsent('granted', client);
      });
      assert.deepEqual(seen, [initOptions()]);
      assert.deepEqual(calls, ['init', 'opt_in', 'record', 'opt_in', 'record']);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
      else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
    }
  });

});
