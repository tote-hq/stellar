import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadLiveSnapshot, readWaitlist } from '../stats/live.ts';
import { FALLBACK_SNAPSHOT } from '../stats/metrics.ts';

const COUNT_URL = 'https://script.example.com/macros/s/fake-deployment/exec';
const SECRET = 'test-waitlist-secret';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test('readWaitlist returns null and fetches nothing when the count URL is unset', async () => {
  let calls = 0;
  const count = await readWaitlist({
    fetch: async () => {
      calls += 1;
      throw new Error('fetch should not run');
    },
    env: {},
    now: () => new Date('2026-11-24T12:00:00.000Z'),
  });
  assert.equal(count, null);
  assert.equal(calls, 0);
});

test('readWaitlist returns the count and sends the shared secret as a query parameter', async () => {
  const urls: string[] = [];
  const count = await readWaitlist({
    fetch: async (input) => {
      urls.push(hrefOf(input));
      return json({ count: 47 });
    },
    env: { STATS_WAITLIST_COUNT_URL: COUNT_URL, WAITLIST_WEBHOOK_SECRET: SECRET },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
  });
  assert.equal(count, 47);
  assert.equal(urls.length, 1);
  const requested = new URL(urls[0] ?? '');
  assert.equal(`${requested.origin}${requested.pathname}`, COUNT_URL);
  assert.equal(requested.searchParams.get('secret'), SECRET);
});

test('readWaitlist ignores a non-HTTPS URL and a rejected or malformed payload', async () => {
  let calls = 0;
  const http = await readWaitlist({
    fetch: async () => {
      calls += 1;
      return json({ count: 1 });
    },
    env: { STATS_WAITLIST_COUNT_URL: 'http://script.example.com/exec', WAITLIST_WEBHOOK_SECRET: SECRET },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
  });
  assert.equal(http, null);
  assert.equal(calls, 0);

  const rejected = await readWaitlist({
    fetch: async () => json({ ok: false, error: 'unauthorized' }),
    env: { STATS_WAITLIST_COUNT_URL: COUNT_URL, WAITLIST_WEBHOOK_SECRET: SECRET },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
  });
  assert.equal(rejected, null);

  const malformed = await readWaitlist({
    fetch: async () => json({ count: '47' }),
    env: { STATS_WAITLIST_COUNT_URL: COUNT_URL, WAITLIST_WEBHOOK_SECRET: SECRET },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
  });
  assert.equal(malformed, null);
});

test('a live waitlist count replaces the published figure; a miss keeps the snapshot', async () => {
  const liveFetch: typeof fetch = async (input) => {
    const href = hrefOf(input);
    if (href.includes('script.example.com')) return json({ count: 47 });
    if (href.includes('api.github.com')) return json({ total_count: 102 });
    return json({});
  };
  const live = await loadLiveSnapshot({
    fetch: liveFetch,
    env: { STATS_WAITLIST_COUNT_URL: COUNT_URL, WAITLIST_WEBHOOK_SECRET: SECRET },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    deadlineMs: 200,
    count: async () => null,
  });
  assert.equal(live.sources.waitlist, 'live');
  assert.equal(live.totals.endUsers, 47);
  assert.equal(live.totals.endUsersDelta30d, null);

  const missed = await loadLiveSnapshot({
    fetch: async (input) => {
      if (hrefOf(input).includes('script.example.com')) return json({ ok: false });
      if (hrefOf(input).includes('api.github.com')) return json({ total_count: 102 });
      return json({});
    },
    env: { STATS_WAITLIST_COUNT_URL: COUNT_URL, WAITLIST_WEBHOOK_SECRET: SECRET },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    deadlineMs: 200,
    count: async () => null,
  });
  assert.equal(missed.sources.waitlist, 'unavailable');
  assert.equal(missed.totals.endUsers, FALLBACK_SNAPSHOT.totals.endUsers);

  const unset = await loadLiveSnapshot({
    fetch: async (input) => {
      if (hrefOf(input).includes('api.github.com')) return json({ total_count: 102 });
      return json({});
    },
    env: {},
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    deadlineMs: 200,
    count: async () => null,
  });
  assert.equal(unset.sources.waitlist, 'snapshot');
  assert.equal(unset.totals.endUsers, FALLBACK_SNAPSHOT.totals.endUsers);
});

