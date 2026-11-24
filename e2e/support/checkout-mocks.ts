import type { Page, Route } from '@playwright/test';

import { E2E_CHECKOUT_ADDRESS } from '../../apps/web/lib/e2e-checkout';

/**
 * Scripted test-mode checkout.
 *
 * The virtual-card path this used to drive was removed. What remains is the
 * escrow dialog in `demo` mode: quote, lock, a shopping phase, then "we
 * reached payment and Día was not paid". Every answer here is the wire shape
 * in `apps/web/lib/checkout/types.ts`. Nothing is forwarded to the dev server,
 * so the run does not open Postgres, Upstash, Horizon, Soroban, or a store.
 */

export const ORDER_ID = 'e2eorder00000000000000000000000000000000000000000000000000000001';

const QUOTE = {
  orderId: ORDER_ID,
  amount: '1000000',
  amountCents: 100,
  amountDisplay: '1.00',
  basketHash: 'ab'.repeat(32),
  timeoutSecs: 900,
  arsPerUsd: 1100,
  rateSource: 'e2e-fixture',
  subtotalCentavos: 180_000,
  shippingCentavos: 0,
  totalCentavos: 180_000,
  postalCode: 'C1425',
  postalSource: 'chat' as const,
  chatPostalCode: 'C1425',
  programId: 'C'.repeat(56),
  usdcMint: 'C'.repeat(56),
  mode: 'demo' as const,
};

const OPEN_SIG = 'e2e-open-sig';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  });
}

export interface CheckoutCalls {
  quote: number;
  open: number;
  start: number;
  status: number;
  balance: number;
  login: number;
  networks: string[];
}

export function installCheckoutMocks(page: Page): CheckoutCalls {
  const calls: CheckoutCalls = {
    quote: 0,
    open: 0,
    start: 0,
    status: 0,
    balance: 0,
    login: 0,
    networks: [],
  };
  const startedAt = Date.now();

  const rememberNetwork = (url: string) => {
    const network = new URL(url, 'http://localhost').searchParams.get('network');
    if (network) calls.networks.push(network);
  };

  void page.route('**/api/session/login', async (route) => {
    calls.login += 1;
    await json(route, { ok: true });
  });

  void page.route('**/api/balance**', async (route) => {
    calls.balance += 1;
    rememberNetwork(route.request().url());
    await json(route, {
      address: E2E_CHECKOUT_ADDRESS,
      xlm: '10',
      usdc: '5000000',
      usdcDisplay: '5.00',
      trustline: 'ok',
      network: 'testnet',
    });
  });

  void page.route('**/api/checkout/quote', async (route) => {
    calls.quote += 1;
    await json(route, QUOTE);
  });

  void page.route('**/api/profile**', async (route) => {
    await json(route, { complete: false }, route.request().method() === 'GET' ? 404 : 200);
  });

  void page.route('**/api/checkout/open', async (route) => {
    calls.open += 1;
    await json(route, { openSig: OPEN_SIG });
  });

  void page.route('**/api/checkout/start', async (route) => {
    calls.start += 1;
    await json(route, statusBody('shopping', 'payment'));
  });

  void page.route('**/api/checkout/status**', async (route) => {
    calls.status += 1;
    const stage = Date.now() - startedAt < 1_200 ? 'shopping' : 'done';
    await json(route, statusBody(stage, 'payment'));
  });

  void page.route('**/api/chat', async (route) => {
    await json(route, { error: 'e2e checkout does not call the model' }, 599);
  });

  void page.route('**/api/faucet**', async (route) => {
    await json(route, { error: 'e2e checkout does not call the faucet' }, 599);
  });

  return calls;
}

function statusBody(stage: 'shopping' | 'done', phase: string) {
  return {
    orderId: ORDER_ID,
    stage,
    phase,
    payment: stage === 'done' ? 'not_attempted' : null,
    storeOrderId: null,
    openSig: OPEN_SIG,
    closeSig: null,
    handoffUrl: null,
    amountDisplay: '1.00',
    error: null,
    mode: 'demo',
    alert: null,
  };
}

const FORBIDDEN_HOST = [
  'api.anthropic.com',
  'api.openai.com',
  'supabase.co',
  'upstash.io',
  'privy.io',
  'horizon.stellar.org',
  'horizon-testnet.stellar.org',
  'soroban-rpc.testnet.stellar.gateway.fm',
  'mainnet.sorobanrpc.com',
  'diaonline.supermercadosdia.com.ar',
  'www.coto.com.ar',
  'vtexcommercestable.com.br',
];

/** True when a checkout run must not open this URL. */
export function isForbiddenHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return FORBIDDEN_HOST.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}
