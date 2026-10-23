/**
 * Paths the shopper middleware must not gate.
 * /stats is a public dashboard, including when stats.changuito.me rewrites `/` to it.
 * Session and payment checks stay on /api/*.
 */
export function isPublicStatsPath(pathname: string): boolean {
  return pathname === '/stats' || pathname.startsWith('/stats/');
}
