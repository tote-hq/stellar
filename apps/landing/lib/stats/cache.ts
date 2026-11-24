/**
 * Last good stats snapshot, and the HTTP cache header for the document.
 *
 * The Cache API (`caches.default`) is per-colo and best-effort. A hit inside
 * the fresh window is returned immediately. A hit inside the stale window is
 * returned immediately and refreshed in the background. The header tells
 * Cloudflare's edge to do the same for the HTML and the CSV, so a slow origin
 * is not what the shopper waits on.
 */

import { isStatsDocumentRequest } from './host.ts';
import type { StatsSnapshot } from './metrics.ts';

export const STATS_FRESH_MS = 300_000;
export const STATS_STALE_MS = 600_000;
/** Browser 60s, edge 5 min, then serve stale for 10 min while revalidating. */
export const STATS_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

const CACHE_URL = 'https://stats.changuito.me/__stats/snapshot-v1';
const CACHE_PROBE_MS = 150;

interface WorkerCacheStorage {
  default?: Cache;
}

interface StoredSnapshot {
  storedAt: number;
  snapshot: StatsSnapshot;
}

function defaultCache(): Cache | null {
  const store = (globalThis as { caches?: WorkerCacheStorage }).caches;
  return store?.default ?? null;
}

function isSnapshot(value: unknown): value is StatsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snap = value as StatsSnapshot;
  const totals = snap.totals;
  if (!totals || typeof totals !== 'object') return false;
  if (typeof snap.asOf !== 'string' || !snap.sources || typeof snap.sources !== 'object') return false;
  if (!Array.isArray(snap.txDay) || !Array.isArray(snap.cartDay) || !Array.isArray(snap.recentTxs)) return false;
  return typeof totals.txSolana === 'number' && typeof totals.txStellar === 'number' && typeof totals.mergedPrs === 'number';
}

export async function readCachedSnapshot(): Promise<{ snapshot: StatsSnapshot; ageMs: number } | null> {
  const cache = defaultCache();
  if (!cache) return null;
  try {
    const pending = cache.match(new Request(CACHE_URL));
    const response = await new Promise<Response | undefined | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), CACHE_PROBE_MS);
      pending.then(
        (hit) => {
          clearTimeout(timer);
          resolve(hit);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
    if (!response) return null;
    const body = (await response.json()) as Partial<StoredSnapshot>;
    if (typeof body.storedAt !== 'number' || !isSnapshot(body.snapshot)) return null;
    return { snapshot: body.snapshot, ageMs: Math.max(0, Date.now() - body.storedAt) };
  } catch {
    return null;
  }
}

export async function writeCachedSnapshot(snapshot: StatsSnapshot): Promise<void> {
  const cache = defaultCache();
  if (!cache) return;
  try {
    const body: StoredSnapshot = { storedAt: Date.now(), snapshot };
    const maxAge = Math.ceil((STATS_FRESH_MS + STATS_STALE_MS) / 1000);
    await cache.put(
      new Request(CACHE_URL),
      new Response(JSON.stringify(body), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${maxAge}`,
        },
      }),
    );
  } catch {
    // The cache is an optimization. A put that fails still leaves the page served.
  }
}

function isFlightRequest(request: Request): boolean {
  if (request.headers.get('rsc')) return true;
  if (request.headers.get('next-router-prefetch')) return true;
  if (request.headers.get('next-router-state-tree')) return true;
  return new URL(request.url).searchParams.has('_rsc');
}

/**
 * Set the edge cache header on the stats document and the CSV.
 * Flight requests stay uncached so a prefetch is not stored as the HTML.
 */
export function withStatsCacheHeaders(request: Request, response: Response): Response {
  if (request.method !== 'GET' || response.status !== 200) return response;
  if (isFlightRequest(request) || !isStatsDocumentRequest(request)) return response;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/html') && !type.includes('text/csv')) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', STATS_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
