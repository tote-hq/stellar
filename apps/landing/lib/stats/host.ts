/**
 * stats.changuito.me serves the /stats document at the host root.
 *
 * next.config.ts has the same rewrite for `next dev` and `next start`.
 * The Worker applies it here, before the vinext handler: the deployed
 * Worker was not honoring that config rewrite, so the stats host rendered
 * the marketing home.
 */

const STATS_HOST = 'stats.changuito.me';

function hostnameOf(request: Request): string {
  const url = new URL(request.url);
  const raw = request.headers.get('host') ?? url.host;
  return (raw.split(':')[0] ?? '').toLowerCase();
}

/** Return a request whose path is /stats when the stats host asks for /. */
export function rewriteStatsHost(request: Request): Request {
  if (hostnameOf(request) !== STATS_HOST) return request;
  const url = new URL(request.url);
  if (url.pathname !== '/') return request;
  url.pathname = '/stats';
  return new Request(url, request);
}
