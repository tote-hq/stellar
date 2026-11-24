import handler from 'vinext/server/fetch-handler';

import { rewriteStatsHost } from './lib/stats/host.ts';

/**
 * Optional stats reads. Declaring them in cloudflare.config.ts would make a
 * deploy fail while they are unset, and they are optional. When a secret is
 * present on the request env, copy it onto process.env, which is what
 * lib/stats/load.ts reads. Values are never logged.
 */
const STATS_BINDINGS = [
  'STATS_STELLAR_DATABASE_URL',
  'STATS_SOLANA_DATABASE_URL',
  'STATS_SOLANA_RPC_URL',
  'STATS_STELLAR_DEPOSIT_ADDRESS',
] as const;

const fetchHandler = handler as {
  fetch: (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;
};

function applyStatsBindings(cfEnv: unknown): void {
  if (!cfEnv || typeof cfEnv !== 'object') return;
  const record = cfEnv as Record<string, unknown>;
  for (const name of STATS_BINDINGS) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) process.env[name] = value;
  }
}

export default {
  fetch(request: Request, cfEnv: unknown, ctx: unknown) {
    applyStatsBindings(cfEnv);
    return fetchHandler.fetch(rewriteStatsHost(request), cfEnv, ctx);
  },
};
