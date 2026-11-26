import type { NextConfig } from 'next';

import { appSecurityHeaders, fixtureSecurityHeaders, FIXTURE_PATH } from './lib/security-headers.ts';

const config: NextConfig = {
  // www already drops it; there is no reason to advertise the framework.
  poweredByHeader: false,
  async headers() {
    // Order matters: a later rule's value wins for the same header key, so
    // the fixture's relaxed frame-ancestors has to come second. Outside
    // development `fixtureSecurityHeaders` is empty and the rule is not
    // added at all — see lib/security-headers.ts for why that is two locks.
    const fixture = fixtureSecurityHeaders();
    // SANDBOX_URL is a runtime binding, so the admin document's frame-src
    // cannot be baked here. This host gets no CSP from the config; middleware
    // sets the one header, with the sandbox origin, on the document.
    const security = appSecurityHeaders();
    const csp = security.filter((header) => header.key === 'Content-Security-Policy');
    const rest = security.filter((header) => header.key !== 'Content-Security-Policy');
    return [
      { source: '/:path*', headers: rest },
      {
        source: '/:path*',
        headers: csp,
        missing: [
          { type: 'host', value: 'admin.changuito.me' },
          { type: 'host', value: 'admin.localhost' },
        ],
      },
      ...(fixture.length ? [{ source: FIXTURE_PATH, headers: fixture }] : []),
    ];
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // `@changuito/mcp` is a workspace package of compiled ESM. It gets bundled
  // rather than marked external, because a symlinked workspace package that
  // Next treats as external is not traced into the lambda at all and fails at
  // runtime with MODULE_NOT_FOUND.
  //
  // Bundling it is only safe because `@changuito/mcp/server` has no reference
  // to the checkout module — not even a dynamic one, which a bundler would
  // resolve at build time anyway. See packages/mcp/src/server.ts.
  // The two bindings packages are `stellar contract bindings typescript`
  // output, published from src/ with no dist — see scripts/fixup-bindings.mjs.
  // They are TypeScript, so they must be compiled here rather than treated as
  // ready-made node modules.
  transpilePackages: ['@changuito/mcp', '@changuito/escrow-bindings', '@changuito/usdc-bindings'],

  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,

  // Belt and braces. If the boundary above ever slips, this is the second
  // thing that has to fail before a browser engine ships in a lambda.
  outputFileTracingExcludes: {
    '/api/**': [
      './node_modules/playwright/**',
      './node_modules/playwright-core/**',
      './packages/mcp/dist/checkout/**',
    ],
  },
};

export default config;
