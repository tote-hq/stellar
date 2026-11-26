import { env } from "cloudflare:workers";
import handler from "vinext/server/fetch-handler";

import { applyContractIdBindings } from "./lib/contract-ids.ts";
import { runInDbRequest } from "./lib/db.ts";
import { proxyPostHog } from "./lib/posthog-proxy.ts";
import { applyRpcUrlBindings } from "./lib/rpc-url.ts";

/**
 * Worker entry. The app keeps reading DATABASE_URL. Hyperdrive's connection
 * string is copied onto that name before the request, so the pages and the
 * tests do not import cloudflare:workers.
 */
const fetchHandler = handler as {
  fetch: (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;
};

export default {
  fetch(request: Request, cfEnv: unknown, ctx: unknown) {
    const proxied = proxyPostHog(request);
    if (proxied) return proxied;
    const binding = (env as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE;
    const url = binding?.connectionString?.trim();
    if (url) {
      process.env.DATABASE_URL = url;
      // Still stamped so a host with no request store does not reuse a socket
      // Hyperdrive has already closed. On this Worker the store below is what
      // keeps two overlapping requests from ending each other's client.
      process.env.CHG_DB_REQUEST = crypto.randomUUID();
    }
    // Contract ids are runtime bindings. Copy them before the handler reads
    // them, and do not bake the values into this file.
    applyContractIdBindings(cfEnv);
    applyRpcUrlBindings(cfEnv);
    return runInDbRequest(() => fetchHandler.fetch(request, cfEnv, ctx));
  },
};
