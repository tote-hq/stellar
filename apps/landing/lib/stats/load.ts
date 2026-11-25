import { STATS_FRESH_MS, STATS_STALE_MS, readCachedSnapshot, writeCachedSnapshot } from './cache.ts';
import { deferStatsWork } from './context.ts';
import { isGoodSnapshot, loadLiveSnapshot, raceSignal, type QueryFn } from './live.ts';
import { FALLBACK_SNAPSHOT, type StatsSnapshot } from './metrics.ts';

/** How long a failed read is reused before another attempt. Stops a stampede. */
const FAILURE_MS = 15_000;

/**
 * One read-only count. Only reached when a STATS_*_DATABASE_URL is set on the
 * server. The URL never leaves this function and is never logged. The query
 * is raced against the snapshot signal: a Postgres connect from a Worker can
 * ignore connect_timeout and must not hold the page.
 */
const countQuery: QueryFn = async (url, text, signal) => {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 1, connect_timeout: 2, ssl: 'require' });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    void Promise.race([
      sql.end({ timeout: 1 }).catch(() => undefined),
      new Promise((resolve) => {
        setTimeout(resolve, 200);
      }),
    ]);
  };
  const onAbort = () => end();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const rows = (await raceSignal(sql.unsafe(text) as Promise<unknown[]>, signal)) ?? [];
    const n = Number((rows[0] as { n?: unknown } | undefined)?.n);
    return Number.isFinite(n) ? n : null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    end();
  }
};

let memo: { at: number; value: StatsSnapshot } | undefined;
let failed: { at: number; value: StatsSnapshot } | undefined;
let inflight: Promise<StatsSnapshot> | null = null;

function remember(snapshot: StatsSnapshot): void {
  if (isGoodSnapshot(snapshot)) {
    memo = { at: Date.now(), value: snapshot };
    failed = undefined;
    deferStatsWork(writeCachedSnapshot(snapshot));
    return;
  }
  failed = { at: Date.now(), value: snapshot };
}

function refresh(): Promise<StatsSnapshot> {
  if (!inflight) {
    inflight = loadLiveSnapshot({ fetch, env: process.env, now: () => new Date(), count: countQuery })
      .then((snapshot) => {
        remember(snapshot);
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function failureIsFresh(now: number): boolean {
  return Boolean(failed && now - failed.at < FAILURE_MS);
}

/**
 * The page and the CSV share this read.
 *
 * A fresh memo or a fresh Cache API entry returns immediately. A stale entry
 * returns immediately and refreshes via waitUntil when the Worker provides
 * it. A cold read is the live snapshot, which resolves inside its deadline
 * even when a source or Postgres hangs.
 */
export async function getStatsSnapshot(): Promise<StatsSnapshot> {
  const now = Date.now();
  if (memo && isGoodSnapshot(memo.value)) {
    const age = now - memo.at;
    if (age < STATS_FRESH_MS) return memo.value;
    if (age < STATS_FRESH_MS + STATS_STALE_MS) {
      if (!failureIsFresh(now)) deferStatsWork(refresh());
      return memo.value;
    }
  }

  const cached = await readCachedSnapshot();
  if (cached && isGoodSnapshot(cached.snapshot) && cached.ageMs < STATS_FRESH_MS + STATS_STALE_MS) {
    memo = { at: now - cached.ageMs, value: cached.snapshot };
    if (cached.ageMs >= STATS_FRESH_MS && !failureIsFresh(now)) deferStatsWork(refresh());
    return cached.snapshot;
  }

  if (failed && failureIsFresh(now)) return failed.value;

  try {
    return await refresh();
  } catch (error) {
    console.error('[stats] snapshot failed:', error instanceof Error ? error.message.slice(0, 80) : 'unknown');
    return memo?.value ?? cached?.snapshot ?? failed?.value ?? FALLBACK_SNAPSHOT;
  }
}
