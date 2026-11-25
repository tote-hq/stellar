import type { Frame, Locator, Page } from 'playwright';

import { log } from '../secure/redact.js';
import type { DeliveryAddress } from '../types.js';
import {
  ADDRESS_FIELDS,
  type ButtonSpec,
  type FieldSpec,
} from './selectors.js';

/**
 * Día-specific acting. Everything that must touch the DOM lives here; the
 * classifiers upstairs stay pure.
 *
 * The rule for this file: nothing it types is ever logged. `type` takes a value
 * and reports only which FIELD it filled. A log line saying
 * `filled street` is useful; one saying what it filled would be the worst artifact
 * this project could produce.
 */

const SHORT_MS = 4_000;

/** Locator candidates for a field, best first. */
function candidates(root: Page | Frame, spec: FieldSpec): Locator[] {
  const out: Locator[] = [
    root.getByLabel(spec.label, { exact: false }),
    root.getByPlaceholder(spec.label),
    root.locator(`input[aria-label]`).filter({ hasText: spec.label }),
  ];
  for (const css of spec.css ?? []) out.push(root.locator(css));
  return out;
}

/** The first candidate that is actually on screen, or undefined. */
async function firstVisible(cands: Locator[], timeoutMs = SHORT_MS): Promise<Locator | undefined> {
  for (const c of cands) {
    try {
      const one = c.first();
      await one.waitFor({ state: 'visible', timeout: timeoutMs / cands.length });
      return one;
    } catch {
      // try the next link in the chain
    }
  }
  return undefined;
}

export async function findField(
  root: Page | Frame,
  spec: FieldSpec,
  timeoutMs = SHORT_MS,
): Promise<Locator | undefined> {
  return firstVisible(candidates(root, spec), timeoutMs);
}

export async function findButton(
  root: Page | Frame,
  spec: ButtonSpec,
  timeoutMs = SHORT_MS,
): Promise<Locator | undefined> {
  const byRole = root.getByRole('button', { name: spec.label });
  const count = await byRole.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const b = byRole.nth(i);
    const name = (await b.innerText().catch(() => '')) || '';
    if (spec.avoid?.test(name)) continue;
    if (await b.isVisible().catch(() => false)) return b;
  }
  const rest: Locator[] = [root.getByText(spec.label).first()];
  for (const css of spec.css ?? []) rest.push(root.locator(css));
  return firstVisible(rest, timeoutMs);
}

/**
 * Fill one field. Returns whether it was found. The VALUE never appears in a
 * log line, an error message or a return value.
 */
async function type(
  root: Page | Frame,
  spec: FieldSpec,
  value: string | undefined,
  timeoutMs = SHORT_MS,
): Promise<boolean> {
  if (!value) return false;
  const field = await findField(root, spec, timeoutMs);
  if (!field) {
    if (!spec.optional) log(`[dia] required field '${spec.id}' not found on this page`);
    return false;
  }
  await field.fill('');
  await field.type(value, { delay: 25 });
  log(`[dia] filled ${spec.id}`);
  return true;
}

// ---- address ---------------------------------------------------------------

export interface FillResult {
  filled: string[];
  missing: string[];
}

/**
 * Fill the delivery address form. Postal code goes in first and alone, because
 * VTEX reloads the shipping options around it — anything typed before it can be
 * wiped by that refresh.
 */
export async function fillAddress(page: Page, addr: DeliveryAddress): Promise<FillResult> {
  const filled: string[] = [];
  const missing: string[] = [];

  const put = async (spec: FieldSpec, value: string | undefined): Promise<void> => {
    if (!value) return;
    if (await type(page, spec, value)) filled.push(spec.id);
    else if (!spec.optional) missing.push(spec.id);
  };

  await put(ADDRESS_FIELDS.postalCode!, addr.postalCode);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  await put(ADDRESS_FIELDS.street!, addr.street);
  await put(ADDRESS_FIELDS.number!, addr.number);
  await put(ADDRESS_FIELDS.complement!, addr.complement);
  await put(ADDRESS_FIELDS.reference!, addr.reference);
  await put(ADDRESS_FIELDS.city!, addr.city);
  await put(ADDRESS_FIELDS.receiverName!, addr.receiverName);
  await put(ADDRESS_FIELDS.phone!, addr.phone);

  return { filled, missing };
}
