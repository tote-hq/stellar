/**
 * Runtime switches from the `config` table (migration 0008), so the operator
 * can flip them without a redeploy: `npm run config -- set sandbox_mock true`.
 * `turnstile_disabled` is the same shape (`npm run config -- set turnstile_disabled true`).
 *
 * The table is the only source. A missing row, a missing table or no
 * DATABASE_URL all read as "off", the conservative direction for every flag
 * here: Turnstile stays on unless `turnstile_disabled` is explicitly true.
 * `manual_checkout_flow` is the exception: anything other than
 * `guided` or `headless` reads as `viewer`, which is today's remote browser.
 * Reads are cached for 15 seconds per instance, so a flip takes effect
 * within that on every lambda.
 */
import { db, hasDatabase } from './db.ts';

const TTL_MS = 15_000;

let cached: { at: number; values: Record<string, unknown> } | null = null;

export async function getConfig(now = Date.now()): Promise<Record<string, unknown>> {
  if (cached && now - cached.at < TTL_MS) return cached.values;
  let values: Record<string, unknown> = {};
  if (hasDatabase()) {
    try {
      const rows = await db()`select key, value from config`;
      values = Object.fromEntries(rows.map((r) => [r.key as string, r.value]));
    } catch (err) {
      // A missing table (migration not applied) or a down database: every flag off.
      console.warn('[config] read failed; flags read as off:', err instanceof Error ? err.message : err);
    }
  }
  cached = { at: now, values };
  return values;
}

/** Only a JSON `true` (or the string "true") turns a flag on. */
export function flagOn(values: Record<string, unknown>, key: string): boolean {
  const v = values[key];
  return v === true || v === 'true';
}

/** Presentation of manual checkout. Unknown, missing and a down database are `viewer`. */
export type ManualCheckoutFlow = 'viewer' | 'guided' | 'headless';

export function manualCheckoutFlow(values: Record<string, unknown>): ManualCheckoutFlow {
  const value = values.manual_checkout_flow;
  return value === 'guided' || value === 'headless' ? value : 'viewer';
}

/** Attached to a quote only for a wallet already admitted to manual checkout. */
export function memberFlow(admitted: boolean, values: Record<string, unknown>): ManualCheckoutFlow | undefined {
  return admitted ? manualCheckoutFlow(values) : undefined;
}

export interface SandboxFlags {
  /** Run checkouts on the in-process mock instead of the sandbox service. */
  mock: boolean;
  /** Make the mock's card come back declined (the refund path). */
  mockFail: boolean;
}

export async function sandboxFlags(): Promise<SandboxFlags> {
  const values = await getConfig();
  return { mock: flagOn(values, 'sandbox_mock'), mockFail: flagOn(values, 'sandbox_mock_fail') };
}

/**
 * `turnstile_disabled` in the config table. JSON `true` or the string `"true"`
 * skips the Turnstile widget and the human-token check. A missing row, false,
 * or an unread database leaves the gate on whatever the Turnstile env keys say.
 */
export async function turnstileDisabled(): Promise<boolean> {
  return flagOn(await getConfig(), 'turnstile_disabled');
}

/**
 * `chat_dual_compare` in the config table. JSON `true` or the string `"true"`
 * draws the in-chat Día vs Coto card. A missing row, false, or an unread
 * database leaves it off, so a deploy before the row is set changes nothing
 * the shopper sees. It is not a Worker variable.
 */
export async function chatDualCompareEnabled(): Promise<boolean> {
  return flagOn(await getConfig(), 'chat_dual_compare');
}

/**
 * `chat_dual_checkout_demo` in the config table. JSON `true` or the string
 * `"true"` lets a Día basket offer a mock pay for the matched Coto lines.
 * A missing row, false, or an unread database leaves it off. It is not a
 * Worker variable. Coto checkout still requires `sandbox_mock`.
 */
export async function chatDualCheckoutDemoEnabled(): Promise<boolean> {
  return flagOn(await getConfig(), 'chat_dual_checkout_demo');
}

export interface RetailerSearchConfig {
  /** Search / compare seed order. Defaults to Día then Coto. */
  order: Array<'dia' | 'coto'>;
  enabled: { dia: boolean; coto: boolean };
}

const DEFAULT_RETAILER_SEARCH: RetailerSearchConfig = {
  order: ['dia', 'coto'],
  enabled: { dia: true, coto: true },
};

/**
 * `retailer_search` in the config table. Shape `{ order, enabled }`.
 * Missing or malformed → Día then Coto, both on. `enabled.dia=false` is
 * rejected by the CLI; the reader still returns the stored value so a bad
 * row is visible. Order affects the agent banner and the compare seed.
 */
export function retailerSearch(values: Record<string, unknown>): RetailerSearchConfig {
  const raw = values.retailer_search;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RETAILER_SEARCH, enabled: { ...DEFAULT_RETAILER_SEARCH.enabled } };
  const orderRaw = (raw as { order?: unknown }).order;
  const enabledRaw = (raw as { enabled?: unknown }).enabled;
  const order: Array<'dia' | 'coto'> = [];
  if (Array.isArray(orderRaw)) {
    for (const item of orderRaw) {
      if ((item === 'dia' || item === 'coto') && !order.includes(item)) order.push(item);
    }
  }
  if (order.length === 0) order.push(...DEFAULT_RETAILER_SEARCH.order);
  const enabled = {
    dia: enabledRaw && typeof enabledRaw === 'object' && (enabledRaw as { dia?: unknown }).dia === false ? false : true,
    coto: enabledRaw && typeof enabledRaw === 'object' && (enabledRaw as { coto?: unknown }).coto === false ? false : true,
  };
  return { order, enabled };
}

export async function getRetailerSearch(): Promise<RetailerSearchConfig> {
  return retailerSearch(await getConfig());
}

/**
 * Which testnet USDC the balance line names. Checkout, the escrow and the
 * faucet stay on the mock token under either value.
 *
 * `"circle"` is the only Circle reading. A missing key, a missing table, no
 * database, or any other JSON value reads as mock — the same conservative
 * direction as the other flags. The two keys are independent: a signed-in
 * request never looks at the guest row, and the other way around.
 */
export type UsdcSource = 'mock' | 'circle';

export function usdcSource(values: Record<string, unknown>, signedIn: boolean): UsdcSource {
  const key = signedIn ? 'usdc_source_signed_in' : 'usdc_source_guest';
  return values[key] === 'circle' ? 'circle' : 'mock';
}

/**
 * Mainnet never consults the flag, even when the stored values are `"circle"`.
 * Testnet uses `usdcSource` for the session that is asking.
 */
export function usdcLineSource(
  network: 'testnet' | 'mainnet',
  values: Record<string, unknown>,
  signedIn: boolean,
): UsdcSource {
  if (network !== 'testnet') return 'mock';
  return usdcSource(values, signedIn);
}

/** The session's source. A failed config read is `getConfig`'s warn, then mock. */
export async function getUsdcSource(signedIn: boolean): Promise<UsdcSource> {
  return usdcSource(await getConfig(), signedIn);
}

/** Test-only. A null cache makes the next read hit the table (or read as off). */
export function __setConfigForTests(values: Record<string, unknown> | null, now = Date.now()): void {
  cached = values === null ? null : { at: now, values };
}
