import { readConsent, type ConsentChoice } from './consent.ts';
import { POSTHOG_PROXY_PATH } from './posthog-path.ts';

/**
 * Client wrapper around `posthog-js`.
 *
 * `POSTHOG_KEY` is a literal `process.env.NEXT_PUBLIC_*` read. Next inlines
 * that form into the bundle; a lookup through a variable would ship empty.
 * An empty key makes every export a no-op, so local dev and the tests do
 * not need a project.
 *
 * `applyPostHogConsent` is the only path that loads `posthog-js`. It imports
 * the library and calls `init` only when the choice is `granted` (Accept, or
 * a return visit that already accepted). No choice, or `denied` before any
 * init, does not import it. Init stays opted out
 * (`opt_out_capturing_by_default`); Accept then opts in and starts recording.
 * Decline after Accept opts the running client out and does not import
 * again. `identify` takes the random `analytics_id` only — a `G…` address
 * is refused, because that string is the wallet.
 *
 * `reset()` clears PostHog's own consent and returns to the opted-out
 * default. Logout still calls it, then opts back in and starts recording
 * when `chg_consent` is still `granted`, so signing out does not turn
 * measurement off.
 */

export const POSTHOG_KEY = (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim();

/** Read at call time. Next still inlines the literal; tests can set the env before a call. */
function currentKey(): string {
  return (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim();
}

/** The first-party cookie, read where the banner wrote it. No `document` means no choice. */
function browserConsent(): ConsentChoice | null {
  const doc = (globalThis as { document?: { cookie?: string } }).document;
  return readConsent(doc?.cookie);
}

type CaptureValue = string | number | boolean;

export interface PostHogInitOptions {
  api_host: string;
  ui_host: string;
  autocapture: false;
  capture_pageview: false;
  capture_pageleave: false;
  opt_out_capturing_by_default: true;
  disable_session_recording: true;
  persistence: 'localStorage+cookie';
  disable_surveys: true;
  session_recording: {
    maskAllInputs: true;
    maskTextSelector: string;
    blockSelector: string;
  };
}

/** The slice of `posthog-js` this app calls. Tests pass a stand-in. */
export interface PostHogClient {
  init: (key: string, options: PostHogInitOptions) => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
  startSessionRecording: () => void;
  identify: (id: string) => void;
  reset: () => void;
  capture: (event: string, properties?: Record<string, CaptureValue>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let active: PostHogClient | null = null;
let loading = false;
let pending: 'in' | 'out' | null = null;
let pendingId: string | null = null;
const readyListeners = new Set<() => void>();

export function initOptions(): PostHogInitOptions {
  return {
    api_host: POSTHOG_PROXY_PATH,
    ui_host: 'https://us.posthog.com',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    opt_out_capturing_by_default: true,
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    disable_surveys: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      blockSelector: '.ph-no-capture',
    },
  };
}

export function posthogReady(key: string = currentKey()): boolean {
  return !key.trim() || active !== null;
}

export function onPostHogReady(listener: () => void): () => void {
  if (posthogReady()) {
    listener();
    return () => {};
  }
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function notifyReady(): void {
  for (const listener of readyListeners) listener();
  readyListeners.clear();
}

function applyPending(): void {
  const choice = pending;
  pending = null;
  if (choice === 'in') grantPostHog();
  else if (choice === 'out') denyPostHog();
  if (pendingId && active) active.identify(pendingId);
}

/** The client already created for this page, or null when `posthog-js` has not been loaded. */
function clientRunning(injected?: PostHogClient): PostHogClient | null {
  if (injected) return active === injected ? injected : null;
  return active;
}

/**
 * Load PostHog only after an explicit accept.
 *
 * `granted` initialises once (dynamic `import('posthog-js')` on the real
 * client), then opts in. `null` and `denied` do not import and do not call
 * `init`. A decline after an accept in the same page opts the running client
 * out. A decline that arrives while that first import is still in flight is
 * remembered, so the client does not opt in when the import settles.
 */
export function applyPostHogConsent(
  choice: 'granted' | 'denied' | null,
  injected?: PostHogClient,
  key: string = currentKey(),
): void {
  if (!key.trim()) return;
  if (choice === 'granted') {
    if (!clientRunning(injected)) initPostHog(injected, key);
    grantPostHog();
    return;
  }
  if (choice !== 'denied') return;
  const running = clientRunning(injected);
  if (running) {
    running.opt_out_capturing();
    return;
  }
  if (!injected && loading) pending = 'out';
}

export function initPostHog(injected?: PostHogClient, key: string = currentKey()): void {
  const projectKey = key.trim();
  if (!projectKey) return;
  if (injected) {
    injected.init(projectKey, initOptions());
    active = injected;
    applyPending();
    notifyReady();
    return;
  }
  if (active || loading) return;
  loading = true;
  void import('posthog-js')
    .then((mod) => {
      const ph = mod.default as unknown as PostHogClient;
      ph.init(projectKey, initOptions());
      active = ph;
      loading = false;
      applyPending();
      notifyReady();
    })
    .catch(() => {
      loading = false;
    });
}

export function grantPostHog(): void {
  if (!currentKey() && !active) return;
  if (!active) {
    pending = 'in';
    return;
  }
  active.opt_in_capturing();
  active.startSessionRecording();
}

export function denyPostHog(): void {
  if (!currentKey() && !active) return;
  if (!active) {
    pending = 'out';
    return;
  }
  active.opt_out_capturing();
}

export function identifyWallet(analyticsId: unknown, injected?: PostHogClient, key: string = currentKey()): void {
  if (!key.trim()) return;
  if (typeof analyticsId !== 'string' || !UUID.test(analyticsId)) return;
  const ph = injected ?? active;
  if (!ph) {
    pendingId = analyticsId;
    return;
  }
  pendingId = analyticsId;
  ph.identify(analyticsId);
}

export function resetPostHog(): void {
  pendingId = null;
  if (!active) return;
  active.reset();
  if (browserConsent() !== 'granted') return;
  active.opt_in_capturing();
  active.startSessionRecording();
}

export function capturePostHog(event: string, props?: Record<string, CaptureValue>): void {
  if (!currentKey() || !active) return;
  active.capture(event, props);
}
