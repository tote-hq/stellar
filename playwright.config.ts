import { defineConfig, devices } from '@playwright/test';

import { loadLocalEnv } from './e2e/support/env';

loadLocalEnv();

const landingBaseURL = process.env.LANDING_BASE_URL?.trim() || 'https://www.changuito.me';
const appBaseURL = process.env.APP_BASE_URL?.trim() || 'https://app.changuito.me';

/**
 * Checkout cannot run against a deployment. `/dev/checkout` 404s in
 * production, and the weekly job points this project at `next dev`.
 * Playwright would otherwise boot that server for a production smoke too,
 * so it is added only when this process asked for the checkout project.
 */
const checkoutBaseURL = process.env.CHECKOUT_BASE_URL?.trim() || 'http://localhost:3124';
const requested = new Set(
  process.argv.flatMap((arg, i) =>
    arg === '--project' ? [process.argv[i + 1] ?? ''] : arg.startsWith('--project=') ? [arg.slice(10)] : [],
  ),
);
const runsCheckout = requested.size === 0 || requested.has('checkout');

const turnstileSiteKey = '1x00000000000000000000AA';
const turnstileSecret = '1x0000000000000000000000000000000AA';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  grepInvert: /@quarantine/,
  reporter: process.env.CI
    ? [
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
        ['github'],
        ['list'],
      ]
    : [
        ['html', { open: 'never' }],
        ['list'],
      ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  ...(runsCheckout
    ? {
        webServer: {
          command: 'npm run dev -w @changuito/web',
          url: checkoutBaseURL,
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            CI: process.env.CI ?? '',
            NEXT_PUBLIC_E2E_CHECKOUT: '1',
            NEXT_PUBLIC_TURNSTILE_SITE_KEY: turnstileSiteKey,
            TURNSTILE_SECRET_KEY: turnstileSecret,
          },
        },
      }
    : {}),
  projects: [
    {
      name: 'landing',
      testMatch: /landing\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: landingBaseURL },
    },
    {
      name: 'app',
      testMatch: /app-(guest|auth)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: appBaseURL },
    },
    {
      name: 'shell',
      testMatch: /app-shell\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: appBaseURL },
    },
    {
      name: 'checkout',
      testMatch: /app-frame-checkout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: checkoutBaseURL,
        viewport: { width: 1440, height: 900 },
        trace: 'off',
        video: 'off',
        screenshot: 'off',
      },
      timeout: 180_000,
    },
    {
      // Opt-in Día vs Coto card. `npm run test:e2e:compare` sets COMPARE_E2E.
      // Screenshot and video stay on so a green run still has evidence.
      // test-results/ and playwright-report/ are gitignored.
      name: 'compare',
      testMatch: /app-dual-compare\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: appBaseURL,
        screenshot: 'on',
        video: 'on',
        trace: 'on',
      },
    },
    {
      // Opt-in dual mock pay cards. `npm run test:e2e:dual-checkout` sets DUAL_CHECKOUT_E2E.
      name: 'dual-checkout',
      testMatch: /app-dual-checkout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: appBaseURL,
        screenshot: 'on',
        video: 'on',
        trace: 'on',
      },
    },
  ],
});
