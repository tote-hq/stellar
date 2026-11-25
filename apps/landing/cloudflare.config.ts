import { bindings, defineConfig, defineWorker } from 'cf/config';

const publicNames = [
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'NEXT_PUBLIC_CLARITY_PROJECT_ID',
] as const;

// Present only for the machine that builds. Absent keys stay off this file
// rather than being wiped by a deploy that does not have them. They are
// inlined into the client bundle at build time.
const publicEnv = Object.fromEntries(
  publicNames.flatMap((name) => {
    const value = process.env[name];
    return value ? [[name, bindings.text(value)]] : [];
  }),
);

export default defineConfig({
  worker: defineWorker({
    // The Worker that already serves www, the apex, and stats. Deployed by
    // the owner from this repo. Do not rename it: a new name would be a
    // different Worker, and the custom domains would not follow.
    name: 'changuito-landing',
    entrypoint: './worker.ts',
    // Newest date the workerd pinned with this app can start. A later date
    // fails `vite preview` with ERR_RUNTIME_FAILURE.
    compatibilityDate: '2026-11-11',
    compatibilityFlags: ['nodejs_compat'],
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
    },
    // Hostnames this Worker already serves. A deploy applies this list, so
    // each one is declared and none are added. Preview traffic stays off
    // them: a preview must not take over the live site.
    domains: [
      { hostname: 'changuito.me', production: true, previews: false },
      { hostname: 'www.changuito.me', production: true, previews: false },
      { hostname: 'stats.changuito.me', production: true, previews: false },
    ],
    workersDev: true,
    previewUrls: false,
    env: {
      ASSETS: bindings.assets(),
      // The landing reads NODE_ENV at runtime (Turnstile fails closed, the
      // CSP drops unsafe-eval). On a Worker, process.env holds the bindings.
      NODE_ENV: bindings.text('production'),
      ...publicEnv,
    },
  }),
});
