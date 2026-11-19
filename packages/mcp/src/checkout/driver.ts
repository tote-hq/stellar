import type { Page } from 'playwright';

import type { AppConfig } from '../config.js';
import { log } from '../secure/redact.js';
import type { DeliveryAddress } from '../types.js';
import { fetchOrderForm } from './cart.js';
import { classifyWithJev } from './classify/jev.js';
import { escalateFromPage, type EscalationReason } from './classify/escalate.js';
import { fillAddress } from './dia.js';
import type { FlowDriver, Observation } from './flow.js';
import { readPageState } from './pagestate.js';
import type { Action } from './states.js';
import type { Escalation, Verdict } from './types.js';

/**
 * The only implementation of FlowDriver that touches a browser.
 *
 * Everything decision-shaped lives in flow.ts and states.ts, which are tested
 * with a fake driver. This file is the thin, deliberately boring layer that
 * turns a planned Action into clicks — kept boring precisely because it is the
 * part that cannot be unit-tested without a browser.
 */

export interface LiveDriverOptions {
  page: Page;
  cfg: AppConfig;
  orderFormId?: string;
  address?: DeliveryAddress;
}

export class LiveDriver implements FlowDriver {
  readonly classifyJev?: (ps: Observation['pageState']) => Promise<Verdict | undefined>;

  constructor(private readonly o: LiveDriverOptions) {
    if (o.cfg.jev.enabled) {
      this.classifyJev = (ps) => classifyWithJev(o.cfg, ps);
    }
  }

  async observe(): Promise<Observation> {
    const pageState = await readPageState(this.o.page);
    // The orderForm is Layer 1's input, and it is read through the page's own
    // cookie jar — same endpoint as the anonymous adapter, as the logged-in
    // user. A failure here is not fatal: Layers 2 and 3 work on the DOM alone.
    let orderForm;
    try {
      orderForm = await fetchOrderForm(this.o.page.request, this.o.cfg, this.o.orderFormId);
    } catch (e) {
      log(`[driver] could not read the orderForm: ${(e as Error).message}`);
    }
    return { pageState, orderForm };
  }

  async perform(action: Action): Promise<void> {
    const { page } = this.o;
    switch (action.kind) {
      case 'click': {
        await page
          .getByRole('button', { name: action.label, exact: false })
          .first()
          .click({ timeout: 8_000 })
          .catch(async () => {
            // Some VTEX controls are anchors or divs with a button role absent.
            await page.getByText(action.label, { exact: false }).first().click({ timeout: 8_000 });
          });
        await settle(page);
        return;
      }

      case 'fill_address': {
        if (!this.o.address) throw new Error('fill_address was planned with no address held.');
        const r = await fillAddress(page, this.o.address);
        log(`[driver] address: filled ${r.filled.join(', ') || 'nothing'}`);
        if (r.missing.length) log(`[driver] address fields not found: ${r.missing.join(', ')}`);
        await settle(page);
        return;
      }

      case 'wait':
        await settle(page);
        return;

      case 'none':
        return;
    }
  }

  async escalate(
    verdict: Verdict | undefined,
    obs: Observation,
    reason: EscalationReason,
    extra?: string,
  ): Promise<Escalation> {
    return escalateFromPage(this.o.page, this.o.cfg, verdict, obs.pageState, reason, extra);
  }

  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return this.o.page.waitForTimeout(ms);
  }
}

/** Let the SPA finish whatever the click started, without failing on a timeout. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
