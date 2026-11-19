/**
 * Free analytics for the shopper. GA4, Meta Pixel, Microsoft Clarity and PostHog.
 *
 * Empty or malformed public ids mean that vendor is a no-op: no scripts, no
 * queued events, no thrown errors. PostHog is on when `NEXT_PUBLIC_POSTHOG_KEY`
 * is non-empty. Nothing is sent until the shopper accepts (`chg_consent=granted`).
 * A decline, or no choice yet, drops the event instead of queueing it, so a
 * later accept cannot describe a moment from before the choice. Props are
 * coarse on purpose. Email, names, message text, cart lines and payment
 * amounts never leave.
 */
import { readConsent } from './consent.ts';
import { capturePostHog, posthogReady } from './posthog.ts';

export type AnalyticsValue = string | number | boolean;

export interface AnalyticsIds {
  ga: string;
  meta: string;
  clarity: string;
  /** True when `NEXT_PUBLIC_POSTHOG_KEY` is non-empty. The key itself stays out of events. */
  posthog: boolean;
}

export interface AnalyticsSink {
  gtag?: (command: string, name: string, params?: Record<string, AnalyticsValue>) => void;
  fbq?: (command: string, name: string, params?: Record<string, AnalyticsValue>) => void;
  clarity?: (command: string, name: string) => void;
  posthog?: (event: string, props?: Record<string, AnalyticsValue>) => void;
}

const GA_ID = /^G-[A-Z0-9]+$/;
const META_ID = /^\d{6,20}$/;
const CLARITY_ID = /^[a-z0-9]{4,32}$/i;

/** Keys that would carry a person, a basket or a price. Dropped, not redacted. */
const BLOCKED_KEYS = new Set([
  'address',
  'amount',
  'body',
  'cart',
  'email',
  'dni',
  'password',
  'cvv',
  'pan',
  'token',
  'secret',
  'items',
  'message',
  'name',
  'price',
  'query',
  'text',
  'total',
]);

const META_STANDARD: Record<string, string> = {
  search_submit: 'Search',
  payment_view: 'ViewContent',
  payment_start: 'InitiateCheckout',
  payment_success: 'Purchase',
};

export function matchAnalyticsId(raw: string | undefined, pattern: RegExp): string {
  const value = (raw ?? '').trim();
  return pattern.test(value) ? value : '';
}

export function readAnalyticsIds(env: {
  ga?: string;
  meta?: string;
  clarity?: string;
  posthog?: string;
}): AnalyticsIds {
  return {
    ga: matchAnalyticsId(env.ga, GA_ID),
    meta: matchAnalyticsId(env.meta, META_ID),
    clarity: matchAnalyticsId(env.clarity, CLARITY_ID),
    posthog: (env.posthog ?? '').trim().length > 0,
  };
}

/**
 * Literal `process.env.NEXT_PUBLIC_*` reads. Next inlines those names into
 * the client bundle; a bracket lookup would ship as empty in production.
 */
export const ANALYTICS_IDS = readAnalyticsIds({
  ga: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  meta: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  clarity: process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID,
  posthog: process.env.NEXT_PUBLIC_POSTHOG_KEY,
});

export function analyticsConfigured(ids: AnalyticsIds = ANALYTICS_IDS): boolean {
  return Boolean(ids.ga || ids.meta || ids.clarity || ids.posthog);
}

export function sanitizeProps(
  props?: Record<string, unknown>,
): Record<string, AnalyticsValue> | undefined {
  if (!props) return undefined;
  const out: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') {
      if (value.length === 0 || value.length > 40) continue;
      if (value.includes('@') || value.includes(' ')) continue;
      out[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Map a bubble the shopper can already see onto a short code. The text stays on
 * screen only.
 *
 * Both languages, because the footer decides which one was written and a code
 * that only recognises Spanish would file every English reader's failure as
 * `unknown` — which looks like a quiet outage in the dashboard rather than the
 * same errors under a different spelling. The Spanish prefixes are unchanged;
 * the English ones are the counterparts from `use-chat.ts`, `loop.ts` and
 * `login-constants.ts`. The two local-model lines have no English twin on
 * purpose: nothing has emitted them since the local model came out, and they
 * are kept only to classify rows already in a backlog (CLAUDE.md §5).
 */
export function errorCode(message: string): string {
  if (message.startsWith('Para seguir, iniciá sesión')) return 'login_required';
  if (message.startsWith('To carry on, sign in')) return 'login_required';
  if (message.startsWith('I could not save the session')) return 'session';
  if (message.startsWith('The connection dropped')) return 'connection';
  if (message.startsWith('The reply cut out')) return 'truncated';
  if (message.startsWith('The search took too long')) return 'timeout';
  if (message.startsWith('I went round in circles')) return 'stuck';
  if (message.startsWith('The server answered')) return 'http';
  if (message.startsWith('No pude guardar la sesión')) return 'session';
  if (message.startsWith('Se cortó la conexión')) return 'connection';
  if (message.startsWith('Se cortó la respuesta')) return 'connection';
  if (message.startsWith('La respuesta se cortó')) return 'truncated';
  if (message.startsWith('La búsqueda tardó demasiado')) return 'timeout';
  if (message.startsWith('Ollama tardó demasiado')) return 'local_model';
  if (message.startsWith('El modelo local falló')) return 'local_model';
  if (message.startsWith('Me quedé dando vueltas')) return 'stuck';
  if (message.startsWith('No puedo responder')) return 'refused';
  if (message.startsWith('El servidor respondió')) return 'http';
  return 'unknown';
}

export function emitAnalytics(
  event: string,
  props: Record<string, unknown> | undefined,
  ids: AnalyticsIds,
  sink: AnalyticsSink,
): void {
  if (!analyticsConfigured(ids)) return;
  const safe = sanitizeProps(props);
  if (ids.ga && sink.gtag) sink.gtag('event', event, safe);
  if (ids.meta && sink.fbq) {
    const standard = META_STANDARD[event];
    if (standard) sink.fbq('track', standard, safe);
    else sink.fbq('trackCustom', event, safe);
  }
  if (ids.clarity && sink.clarity) sink.clarity('event', event);
  if (ids.posthog && sink.posthog) sink.posthog(event, safe);
}

interface AnalyticsWindow {
  gtag?: AnalyticsSink['gtag'];
  fbq?: AnalyticsSink['fbq'];
  clarity?: AnalyticsSink['clarity'];
}

interface PageGlobals {
  window?: AnalyticsWindow;
  document?: { cookie: string };
}

const pending: Array<{ event: string; props?: Record<string, unknown> }> = [];

function globals(): { window: AnalyticsWindow; document: { cookie: string } } | null {
  const host = globalThis as PageGlobals;
  if (!host.window || !host.document) return null;
  return { window: host.window, document: host.document };
}

function browserSink(win: AnalyticsWindow, ids: AnalyticsIds): AnalyticsSink {
  return {
    gtag: win.gtag,
    fbq: win.fbq,
    clarity: win.clarity,
    posthog: ids.posthog && posthogReady() ? (event, props) => capturePostHog(event, props) : undefined,
  };
}

function vendorsReady(ids: AnalyticsIds, sink: AnalyticsSink): boolean {
  if (ids.ga && typeof sink.gtag !== 'function') return false;
  if (ids.meta && typeof sink.fbq !== 'function') return false;
  if (ids.clarity && typeof sink.clarity !== 'function') return false;
  if (ids.posthog && typeof sink.posthog !== 'function') return false;
  return true;
}

export function track(
  event: string,
  props?: Record<string, unknown>,
  ids: AnalyticsIds = ANALYTICS_IDS,
  sink?: AnalyticsSink,
): void {
  const here = globals();
  if (!here || !analyticsConfigured(ids)) return;
  // Before the choice, and after a decline, the event is gone. Queueing it
  // would send a description of a moment the shopper had not agreed to.
  if (readConsent(here.document.cookie) !== 'granted') return;
  const resolved = sink ?? browserSink(here.window, ids);
  if (!vendorsReady(ids, resolved)) {
    if (pending.length < 32) pending.push({ event, props });
    return;
  }
  emitAnalytics(event, props, ids, resolved);
}

/** Called once each vendor snippet has defined its function. */
export function flushAnalytics(ids: AnalyticsIds = ANALYTICS_IDS, sink?: AnalyticsSink): void {
  const here = globals();
  if (!here || !analyticsConfigured(ids)) return;
  if (readConsent(here.document.cookie) !== 'granted') {
    pending.length = 0;
    return;
  }
  const resolved = sink ?? browserSink(here.window, ids);
  if (!vendorsReady(ids, resolved)) return;
  const batch = pending.splice(0, pending.length);
  for (const item of batch) emitAnalytics(item.event, item.props, ids, resolved);
}

export function trackLoginStart(open?: () => void): void {
  track('login_start');
  open?.();
}
