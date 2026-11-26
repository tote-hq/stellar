/**
 * The client for services/sandbox: a Jev + Playwright worker on Railway that
 * logs into the shopper's Día account, fills its cart with the basket and
 * walks checkout.
 *
 *   POST {SANDBOX_URL}/jobs        { order_id, items, shopper }   -> { job_id }
 *   GET  {SANDBOX_URL}/jobs/{id}                                  -> SandboxJob
 *
 * `shopper` carries the shopper's Día login. A job may still carry a card in
 * the request body — the sandbox schema is unchanged — but this app no longer
 * sends one. A job with no card stops at the payment step and the order refunds.
 *
 * The mock is switched in the `config` table (lib/config.ts), not the
 * environment: `npm run config -- set sandbox_mock true` makes every new
 * checkout run on an in-process mock that walks the same phases on a clock
 * (~25s) and reports a placed order, even when SANDBOX_URL is set. That is how
 * the escrow flow is exercised without a browser farm, and how a demo turns
 * the real sandbox off in seconds. `sandbox_mock_fail` makes the mock's card
 * come back declined, which is the refund path. Neither flag set and no
 * SANDBOX_URL: checkout is off and every locked order refunds.
 *
 * A wallet not on the shared card's member list gets the demo run instead
 * (`startJob(..., { demo: true })`): the same mock, whatever the flags say,
 * stopping at payment without paying, so the order refunds and the dialog
 * hands off to the cart link.
 *
 * The mock is stateless on purpose: the phase is derived from when the job
 * started, so it survives Next compiling each route into its own bundle.
 */

export type SandboxPhase =
  | 'queued'
  | 'login'
  | 'delivery'
  | 'empty_cart'
  | 'shop'
  | 'checkout'
  | 'payment'
  | 'needs_human'
  | 'needs_shopper'
  | 'placed';

/** What the store answered to the card. Only `placed` settles the escrow. */
export type SandboxPayment = 'placed' | 'declined' | 'not_attempted' | 'error';

export interface SandboxJob {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  phase: SandboxPhase;
  /** Present when status is done or failed. */
  result?: {
    /** True when the job reached Día's card step. */
    reached_payment: boolean;
    payment?: SandboxPayment;
    /** One line from the store's answer, with known personal values redacted by the sandbox. */
    payment_detail?: string | null;
    /** Día's order number, or the Coto order id, when placed. */
    store_order_id?: string | null;
    /** Sandbox failure code. The shopper response maps it to Spanish and does not forward it. */
    code?: string | null;
    items_added: number;
    cart?: {
      orderFormId?: string;
      value?: number;
      shipping_centavos?: number | null;
      items?: { name: string; quantity: number; price?: number }[];
    };
    final_url?: string;
    wall_s?: number;
    timings?: Record<string, number>;
  };
  error?: string;
  prompt?: {
    label: string;
    fieldRef?: string | null;
    options?: { label: string; value: string; suggested?: boolean }[] | null;
  };
}

export interface SandboxItem {
  name: string;
  quantity: number;
  sku: string;
}

/** The card to pay with, as the sandbox's `Card` model takes it. Never logged; see the header. */
export interface SandboxCard {
  pan: string;
  cvv: string;
  exp_month: string;
  exp_year: string;
  holder: string;
  kind: 'debit' | 'credit';
}

/** The shopper's Día login and where to deliver. Never stored; see the header. */
export interface SandboxShopper {
  email: string;
  password: string;
  dni: string;
  postcode?: string;
  street?: string;
  number?: string;
  phone?: string;
  complement?: string;
}

/** The two `config` flags this client reads. Mirrors lib/config.ts `SandboxFlags`; kept here so tests need no db. */
export interface MockFlags {
  mock: boolean;
  mockFail: boolean;
}

export function sandboxMode(flags: MockFlags, env: NodeJS.ProcessEnv = process.env): 'remote' | 'mock' | 'off' {
  if (flags.mock) return 'mock';
  return env.SANDBOX_URL ? 'remote' : 'off';
}

function remote(env: NodeJS.ProcessEnv) {
  const base = env.SANDBOX_URL!.replace(/\/$/, '');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${env.SANDBOX_TOKEN ?? ''}` };
  return { base, headers };
}

/**
 * `demo` is the run for a wallet that is not on an admitted manual checkout
 * (lib/checkout/mode.ts): always the mock, whatever the flags
 * and SANDBOX_URL say, and it stops at the payment step instead of placing,
 * so the order refunds and the shopper finishes in Día from the cart link.
 * No Día login is needed for it, so `shopper` may be absent.
 */
export async function startJob(
  orderId: string,
  items: SandboxItem[],
  shopper: SandboxShopper | undefined,
  card: SandboxCard | undefined,
  flags: MockFlags,
  env: NodeJS.ProcessEnv = process.env,
  opts: { demo?: boolean } = {},
): Promise<string> {
  if (opts.demo) return `mock-h-${Date.now()}-${items.length}`;
  const mode = sandboxMode(flags, env);
  if (mode === 'off') throw new Error('checkout is off: no SANDBOX_URL and sandbox_mock is not on');
  if (mode === 'mock') {
    const fail = flags.mockFail ? 'f' : 'k';
    return `mock-${fail}-${Date.now()}-${items.length}`;
  }
  if (!shopper) throw new Error('a sandbox run needs the shopper\'s Día login');
  const { base, headers } = remote(env);
  const res = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ order_id: orderId, items, shopper, ...(card ? { card } : {}) }),
  });
  if (!res.ok) throw new Error(`sandbox answered ${res.status}`);
  const body = (await res.json()) as { job_id?: string };
  if (!body.job_id) throw new Error('sandbox returned no job_id');
  return body.job_id;
}

export interface CotoRealDelivery {
  postalCode: string;
  street: string;
  number?: string;
  city: string;
  complement?: string;
}

/** Sandbox body for a real Coto job. No Día login and no card. Payment uses the card saved on the Coto account. */
export function cotoRealJobBody(
  orderId: string,
  items: SandboxItem[],
  input: { fulfillment: 'home' | 'pickup'; city: string; delivery?: CotoRealDelivery },
): {
  mode: 'coto_real';
  order_id: string;
  fulfillment: 'home' | 'pickup';
  city: string;
  items: { name: string; quantity: number; sku: string }[];
  delivery?: CotoRealDelivery;
} {
  return {
    mode: 'coto_real',
    order_id: orderId,
    fulfillment: input.fulfillment,
    city: input.city,
    items: items.map((item) => ({ name: item.name, quantity: item.quantity, sku: item.sku })),
    ...(input.delivery ? { delivery: input.delivery } : {}),
  };
}

export async function startCotoRealJob(
  orderId: string,
  items: SandboxItem[],
  input: { fulfillment: 'home' | 'pickup'; city: string; delivery?: CotoRealDelivery },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!env.SANDBOX_URL) throw new Error('checkout is off: no SANDBOX_URL');
  const { base, headers } = remote(env);
  const res = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cotoRealJobBody(orderId, items, input)),
  });
  if (!res.ok) throw new Error(`sandbox answered ${res.status}`);
  const body = (await res.json()) as { job_id?: string };
  if (!body.job_id) throw new Error('sandbox returned no job_id');
  return body.job_id;
}

/** Seconds into a mock job at which each phase begins. */
const MOCK_PLAN: [number, SandboxPhase][] = [
  [0, 'login'],
  [4, 'empty_cart'],
  [7, 'shop'],
  [15, 'checkout'],
  [20, 'payment'],
  [24, 'placed'],
];

function mockJob(jobId: string): SandboxJob {
  const [, flag, started, count] = jobId.split('-');
  const elapsed = (Date.now() - Number(started)) / 1000;
  let phase: SandboxPhase = 'login';
  for (const [at, p] of MOCK_PLAN) if (elapsed >= at) phase = p;
  const items = Number(count) || 0;

  if (phase !== 'placed') return { job_id: jobId, status: 'running', phase };
  // Demo: reached the payment step and stopped there on purpose. Never placed,
  // so the escrow refunds; the modal hands off to the cart link.
  if (flag === 'h') {
    return {
      job_id: jobId,
      status: 'done',
      phase: 'payment',
      result: {
        reached_payment: true,
        payment: 'not_attempted',
        payment_detail: 'demo: stopped at payment (not a card member)',
        store_order_id: null,
        items_added: items,
        cart: { orderFormId: `mock-orderform-${started}` },
        final_url: 'https://diaonline.supermercadosdia.com.ar/checkout/#/payment',
        wall_s: Math.round(elapsed),
      },
    };
  }
  const declined = flag === 'f';
  return {
    job_id: jobId,
    status: 'done',
    phase: declined ? 'payment' : 'placed',
    result: {
      reached_payment: true,
      payment: declined ? 'declined' : 'placed',
      payment_detail: declined ? 'mock: card declined (sandbox_mock_fail)' : 'mock: order placed',
      store_order_id: declined ? null : `mock-${started}`,
      items_added: items,
      cart: { orderFormId: `mock-orderform-${started}` },
      final_url: 'https://diaonline.supermercadosdia.com.ar/checkout/#/payment',
      wall_s: Math.round(elapsed),
    },
  };
}

export async function readJob(jobId: string, env: NodeJS.ProcessEnv = process.env): Promise<SandboxJob> {
  if (jobId.startsWith('mock-')) return mockJob(jobId);
  const { base, headers } = remote(env);
  const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}`, { headers, cache: 'no-store' });
  // The worker keeps jobs in memory. A 404 means it restarted and the job is
  // gone: that is a failure, and the escrow refunds.
  if (res.status === 404) return { job_id: jobId, status: 'failed', phase: 'queued', error: 'job lost (sandbox restarted)' };
  if (!res.ok) throw new Error(`sandbox answered ${res.status}`);
  return (await res.json()) as SandboxJob;
}

export async function postCotoShopperAnswer(
  jobId: string,
  fieldRef: string,
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!env.SANDBOX_URL) return false;
  const { base, headers } = remote(env);
  const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/answer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ field_ref: fieldRef, value }),
  });
  return res.ok;
}

/** Origin of `SANDBOX_URL`, for the admin document's frame-src. Null when it is unset or not a URL. */
export function sandboxOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.SANDBOX_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export interface CotoViewer {
  url: string;
  ticket: string;
  jobId: string;
}

/**
 * Signed while the operator still needs the Coto screen. Not stored.
 * A URL whose origin is not the sandbox is dropped.
 */
export async function readCotoViewer(
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CotoViewer | null> {
  const expected = sandboxOrigin(env);
  if (!expected) return null;
  const { base, headers } = remote(env);
  const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/viewer`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  const body = (await res.json()) as { url?: unknown; ticket?: unknown; job_id?: unknown };
  if (typeof body.url !== 'string' || typeof body.ticket !== 'string' || typeof body.job_id !== 'string') return null;
  try {
    if (new URL(body.url).origin !== expected) return null;
  } catch {
    return null;
  }
  return { url: body.url, ticket: body.ticket, jobId: body.job_id };
}
