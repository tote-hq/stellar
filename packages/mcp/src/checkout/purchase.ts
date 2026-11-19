import { payableTotal, totalizerBreakdown, type VtexOrderForm } from '../adapters/orderform.js';
import type { AppConfig } from '../config.js';
import type { Centavos, DeliveryAddress } from '../types.js';
import { formatARS } from '../util/money.js';
import type { SessionRun } from './browser.js';
import { handoffUrl } from './cart.js';
import { LiveDriver } from './driver.js';
import { type FlowResult, runFlow } from './flow.js';
import { Escalation } from './types.js';

/**
 * Drive a logged-in checkout as far as the payment form and stop.
 *
 * Nothing here pays. The total comes from the orderForm. A dry run and
 * `review_order` both call `driveToPayment`.
 */

export interface ReviewResult {
  flow: FlowResult;
  orderForm?: VtexOrderForm;
  /** Items + shipping: the number that will be charged. */
  totalCentavos: Centavos;
  breakdown: Array<{ id: string; name: string; centavos: number }>;
  /** Where the user can open this exact cart in their own browser. */
  cartUrl: string;
  summary: string;
}

export interface DriveOptions {
  orderFormId?: string;
  address?: DeliveryAddress;
  maxSteps?: number;
  maxMs?: number;
}

/**
 * Drive the user's real, logged-in checkout as far as the payment form and
 * stop. No card is created, nothing is submitted.
 */
export async function driveToPayment(
  run: SessionRun,
  cfg: AppConfig,
  opts: DriveOptions = {},
): Promise<ReviewResult> {
  const { page } = run;
  const orderFormId = opts.orderFormId;

  if (orderFormId) {
    await page.goto(handoffUrl(cfg, orderFormId), { waitUntil: 'domcontentloaded' });
  } else if (!/\/checkout/.test(page.url())) {
    await page.goto(`https://${cfg.host}/checkout/#/cart`, { waitUntil: 'domcontentloaded' });
  }

  const driver = new LiveDriver({ page, cfg, orderFormId, address: opts.address });
  const flow = await runFlow(driver, {
    goal: 'payment_form',
    maxSteps: opts.maxSteps ?? cfg.browser.maxSteps,
    maxMs: opts.maxMs ?? cfg.browser.maxMs,
    hasAddress: Boolean(opts.address),
  });

  const of = flow.orderForm;
  const total = of ? payableTotal(of) : 0;
  const cartUrl = handoffUrl(cfg, of?.orderFormId ?? orderFormId ?? '');

  return {
    flow,
    orderForm: of,
    totalCentavos: total,
    breakdown: of ? totalizerBreakdown(of) : [],
    cartUrl,
    summary: describeReview(flow, total, cartUrl),
  };
}

function describeReview(flow: FlowResult, total: Centavos, cartUrl: string): string {
  const lines = [
    flow.reached
      ? `Reached the payment step in ${flow.steps} step(s).`
      : `Stopped at '${flow.verdict.state}': ${flow.verdict.why}`,
    `Total to pay: ${formatARS(total)}`,
    `Open this cart yourself: ${cartUrl}`,
  ];
  if (flow.verdict.problems?.length) {
    lines.push('', 'The store flagged:', ...flow.verdict.problems.map((p) => `  - ${p}`));
  }
  return lines.join('\n');
}


/** True when a thrown error is the loop asking the user a question. */
export function isEscalation(e: unknown): e is Escalation {
  return e instanceof Escalation;
}
