import { unstable_cache } from 'next/cache';

import { loadLiveSnapshot, type QueryFn } from './live.ts';
import { FALLBACK_SNAPSHOT, type StatsSnapshot } from './metrics.ts';

/** Seconds between live reads. The page and the CSV share one cached read. */
export const STATS_REVALIDATE = 300;

/**
 * One read-only count. Only reached when a STATS_*_DATABASE_URL is set on the
 * server. The URL never leaves this function and is never logged.
 */
const countQuery: QueryFn = async (url, text) => {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 5, ssl: 'require' });
  try {
    const rows = await sql.unsafe(text);
    const n = Number((rows[0] as { n?: unknown } | undefined)?.n);
    return Number.isFinite(n) ? n : null;
  } finally {
    await sql.end({ timeout: 2 });
  }
};

const cached = unstable_cache(
  () => loadLiveSnapshot({ fetch, env: process.env, now: () => new Date(), count: countQuery }),
  ['changuito-stats-v1'],
  { revalidate: STATS_REVALIDATE, tags: ['stats'] },
);

/**
 * Per-isolate memo. `unstable_cache` has a shared store on Next and may have
 * none on a Worker; either way one isolate should not repeat the public RPC
 * scan on every request inside the window. A failed read keeps the previous
 * value when there is one.
 */
let memo: { at: number; value: StatsSnapshot } | undefined;

async function readSnapshot(): Promise<StatsSnapshot> {
  try {
    return await cached();
  } catch (error) {
    console.error(
      '[stats] cached read failed:',
      error instanceof Error ? error.message.slice(0, 80) : 'unknown',
    );
    return loadLiveSnapshot({ fetch, env: process.env, now: () => new Date(), count: countQuery });
  }
}

export async function getStatsSnapshot(): Promise<StatsSnapshot> {
  const now = Date.now();
  if (memo && now - memo.at < STATS_REVALIDATE * 1000) return memo.value;
  try {
    const value = await readSnapshot();
    memo = { at: now, value };
    return value;
  } catch {
    return memo?.value ?? FALLBACK_SNAPSHOT;
  }
}
