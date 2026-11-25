import type { NextConfig } from 'next';

import { STATS_CACHE_CONTROL } from './lib/stats/cache.ts';
import { landingSecurityHeaders } from './lib/csp.ts';

const config: NextConfig = {
  poweredByHeader: false,
  // Shared footer trust line. Source is TypeScript, compiled with the app.
  transpilePackages: ['@changuito/trust'],
  // Next 16 blocks the dev HMR socket when the browser host is 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1'],
  // Hoisted workspace deps live at the repo root, not in this package.
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  async headers() {
    const cache = { key: 'Cache-Control', value: STATS_CACHE_CONTROL };
    return [
      { source: '/:path*', headers: landingSecurityHeaders() },
      // `next dev` / `next start`. The Worker sets the same header after the
      // handler, which is what production runs, and it skips flight requests.
      { source: '/stats', headers: [cache] },
      { source: '/stats/export', headers: [cache] },
    ];
  },
  // stats.changuito.me serves this app's /stats document at the host root.
  // `next dev` / `next start` apply this. The Worker entry applies the same
  // rule in worker.ts before the vinext handler, which is what production runs.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/',
          has: [{ type: 'host', value: 'stats.changuito.me' }],
          destination: '/stats',
        },
      ],
    };
  },
};

export default config;
