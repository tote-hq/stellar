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
 *
 * Pageviews follow client-side navigations (`history_change`) and only
 * after Accept, because init stays opted out until `opt_in_capturing`.
 * `$pageview` and `$pageleave` keep the path and drop the query string:
 * `/dev/checkout` puts an amount in `total`, and a captured URL must not.
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

/** The slice of a PostHog event `before_send` is allowed to edit. */
export interface PostHogSentEvent {
  event: string;
  properties: Record<string, unknown>;
}

export interface PostHogInitOptions {
  api_host: string;
  ui_host: string;
  autocapture: false;
  capture_pageview: 'history_change';
  capture_pageleave: 'if_capture_pageview';
  opt_out_capturing_by_default: true;
  disable_session_recording: true;
  persistence: 'localStorage+cookie';
  disable_surveys: true;
  session_recording: {
    maskAllInputs: true;
    maskTextSelector: string;
    blockSelector: string;
  };
  before_send: (event: PostHogSentEvent) => PostHogSentEvent;
}

const PAGE_URL_PROPS = ['$current_url', '$referrer'] as const;

/**
 * `$pageview` and `$pageleave` carry the document URL. Drop the query
 * string and keep the path and hash. Other events are left as they are:
 * a fetch to `/api/balance?address=` is not a pageview.
 */
export function stripPageviewQuery(event: PostHogSentEvent): PostHogSentEvent {
  if (event.event !== '$pageview' && event.event !== '$pageleave') return event;
  let properties = event.properties;
  let changed = false;
  for (const key of PAGE_URL_PROPS) {
    const value = properties[key];
    if (typeof value !== 'string') continue;
    const next = dropQuery(value);
    if (next === value) continue;
    if (!changed) {
      properties = { ...properties };
      changed = true;
    }
    properties[key] = next;
  }
  return changed ? { ...event, properties } : event;
}

/** Cut `?…` out of a URL. A `?` that sits inside the hash is part of the fragment. */
function dropQuery(url: string): string {
  const query = url.indexOf('?');
  if (query === -1) return url;
  const hash = url.indexOf('#');
  if (hash !== -1 && hash < query) return url;
  const hashAfter = url.indexOf('#', query);
  const path = url.slice(0, query);
  return hashAfter === -1 ? path : path + url.slice(hashAfter);
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
    capture_pageview: 'history_change',
    capture_pageleave: 'if_capture_pageview',
    before_send: stripPageviewQuery,
    opt_out_capturing_by_default: true,
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    disable_surveys: true,
    // `.ph-mask`, not `*`. A star matches body, and this recorder never
    // applies maskTextFn, so a child class cannot unmask. Omitting the
    // selector would fall through to the project setting, which may still
    // be `*`. Sensitive roots use `ph-no-capture` or `ph-mask`.
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.ph-mask',
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
