import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { POSTHOG_PROXY_PATH } from '../posthog-path.ts';
import {
  applyPostHogConsent,
  identifyWallet,
  initOptions,
  initPostHog,
  type PostHogClient,
  type PostHogInitOptions,
} from '../posthog.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
const ADDRESS = `G${'A'.repeat(55)}`;

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
  });

  test('applyPostHogConsent inits only when the choice is granted', () => {
    const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    const inits: PostHogInitOptions[] = [];
    const calls: string[] = [];
    const client: PostHogClient = {
      init(_key, options) {
        inits.push(options);
        calls.push('init');
      },
      opt_in_capturing() {
        calls.push('in');
      },
      opt_out_capturing() {
        calls.push('out');
      },
      startSessionRecording() {
        calls.push('rec');
      },
      identify() {},
      reset() {},
      capture() {},
    };

    try {
      applyPostHogConsent(null, client);
      applyPostHogConsent('denied', client);
      assert.deepEqual(calls, []);

      applyPostHogConsent('granted', client);
      applyPostHogConsent('granted', client);
      assert.deepEqual(inits, [initOptions()]);

      applyPostHogConsent('denied', client);
      assert.equal(inits.length, 1);
      assert.equal(calls[calls.length - 1], 'out');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
      else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
    }
  });
});
