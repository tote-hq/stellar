import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATS_CACHE_CONTROL, withStatsCacheHeaders } from '../stats/cache.ts';
import { isStatsDocumentRequest } from '../stats/host.ts';
import {
  SNAPSHOT_DEADLINE_MS,
  SOLANA_RETRIES,
  SOLANA_SIG_PAGES,
  SOLANA_TX_CAP,
  loadLiveSnapshot,
  type QueryFn,
} from '../stats/live.ts';
import { FALLBACK_SNAPSHOT } from '../stats/metrics.ts';

function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Rejects when the signal aborts. No timer, so a missed abort cannot keep the process alive. */
function hang(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException('aborted', 'AbortError'));
    if (!signal) return;
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

test('request-path caps stay inside one snapshot deadline', () => {
  assert.ok(SNAPSHOT_DEADLINE_MS >= 5_000 && SNAPSHOT_DEADLINE_MS <= 6_000);
  assert.equal(SOLANA_SIG_PAGES, 1);
  assert.equal(SOLANA_RETRIES, 1);
  assert.ok(SOLANA_TX_CAP <= 24);
});

test('snapshot resolves within the deadline when a source hangs', { timeout: 12_000 }, async () => {
  const signals: AbortSignal[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    calls += 1;
    if (init?.signal) signals.push(init.signal);
    if (hrefOf(input).includes('api.github.com')) return Promise.resolve(json({ total_count: 111 }));
    return hang(init?.signal ?? undefined);
  };
  let counted = false;
  const count: QueryFn = () => {
    counted = true;
    return new Promise(() => {});
  };

  const started = Date.now();
  const snap = await loadLiveSnapshot({
    fetch: fetchImpl,
    env: { STATS_SOLANA_DATABASE_URL: 'configured' },
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    count,
  });
  const elapsed = Date.now() - started;

  assert.ok(signals.length > 0, 'fetch received an AbortSignal');
  assert.ok(signals.every((signal) => signal.aborted), 'in-flight fetches were aborted');
  assert.equal(counted, true);
  assert.ok(calls < 30, `scan was not capped (${calls} fetches)`);
  assert.ok(elapsed >= SNAPSHOT_DEADLINE_MS - 150, `returned too early (${elapsed}ms)`);
  assert.ok(elapsed < SNAPSHOT_DEADLINE_MS + 1_500, `returned too late (${elapsed}ms)`);
  assert.equal(snap.sources.github, 'live');
  assert.equal(snap.totals.mergedPrs, 111);
  assert.equal(snap.sources.solana, 'unavailable');
  assert.equal(snap.sources.stellar, 'unavailable');
  assert.equal(snap.sources.appDb, 'unavailable');
  assert.equal(snap.sources.waitlist, 'snapshot');
  assert.equal(snap.totals.txSolana, FALLBACK_SNAPSHOT.totals.txSolana);
  assert.equal(snap.totals.txStellar, FALLBACK_SNAPSHOT.totals.txStellar);
  assert.equal(snap.totals.mergedPrs, 111);
  assert.ok(snap.updatedAt);
});

test('an aborted solana scan keeps signatures it already fetched', async () => {
  let transactionCalls = 0;
  const fetchImpl: typeof fetch = (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    if (hrefOf(input).includes('api.github.com')) return Promise.resolve(json({ total_count: 4 }));
    if (body.includes('getSignaturesForAddress')) {
      return Promise.resolve(
        json({
          result: [
            { signature: 'sigA', err: null, blockTime: 1_762_000_000 },
            { signature: 'sigB', err: null, blockTime: 1_762_000_100 },
          ],
        }),
      );
    }
    if (body.includes('getTransaction')) {
      transactionCalls += 1;
      return hang(init?.signal ?? undefined);
    }
    return hang(init?.signal ?? undefined);
  };

  const started = Date.now();
  const snap = await loadLiveSnapshot({
    fetch: fetchImpl,
    env: {},
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    deadlineMs: 400,
  });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1_500, `partial read took ${elapsed}ms`);
  assert.ok(transactionCalls <= SOLANA_TX_CAP * (SOLANA_RETRIES + 1));
  assert.equal(snap.sources.solana, 'live');
  assert.equal(snap.totals.txSolana, 2);
  assert.equal(snap.totals.cartsSolana, FALLBACK_SNAPSHOT.totals.cartsSolana);
  assert.equal(snap.recentTxs.filter((tx) => tx.network === 'solana').length, 2);
  assert.equal(snap.sources.stellar, 'unavailable');
  assert.equal(snap.sources.github, 'live');
  assert.equal(snap.totals.mergedPrs, 4);
  assert.equal(snap.sources.appDb, 'snapshot');
  assert.equal(snap.totals.txStellar, FALLBACK_SNAPSHOT.totals.txStellar);
});

test('stats documents advertise stale-while-revalidate and flight requests do not', () => {
  const html = () => new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const page = withStatsCacheHeaders(new Request('https://changuito.me/stats'), html());
  assert.equal(page.headers.get('cache-control'), STATS_CACHE_CONTROL);

  const csv = new Response('a,b', { headers: { 'content-type': 'text/csv; charset=utf-8' } });
  const exported = withStatsCacheHeaders(new Request('https://stats.changuito.me/stats/export?range=7d'), csv);
  assert.equal(exported.headers.get('cache-control'), STATS_CACHE_CONTROL);

  const root = withStatsCacheHeaders(new Request('https://stats.changuito.me/'), html());
  assert.equal(root.headers.get('cache-control'), STATS_CACHE_CONTROL);

  const flight = withStatsCacheHeaders(new Request('https://changuito.me/stats', { headers: { rsc: '1' } }), html());
  assert.equal(flight.headers.get('cache-control'), null);

  const home = withStatsCacheHeaders(new Request('https://www.changuito.me/'), html());
  assert.equal(home.headers.get('cache-control'), null);
  assert.equal(isStatsDocumentRequest(new Request('https://www.changuito.me/')), false);
  assert.equal(isStatsDocumentRequest(new Request('https://stats.changuito.me/')), true);
});
