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

export async function getStatsSnapshot(): Promise<StatsSnapshot> {
  try {
    return await cached();
  } catch {
    return FALLBACK_SNAPSHOT;
  }
}
