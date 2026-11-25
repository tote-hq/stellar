import type { Centavos, DeliveryAddress } from './types.js';
import { formatARS } from './util/money.js';

/**
 * The order state machine.
 *
 * It exists for one reason: a model calling tools out of order must not be able
 * to skip a step. `review_order` cannot run before a cart was built in the
 * user's own account, which cannot run before an address was set, which cannot
 * run before a session was linked. Each refusal names the step that is missing
 * rather than failing obscurely.
 *
 * The draft stops at `reviewed`. This server drives the checkout as far as the
 * payment form and does not pay.
 *
 * Everything here is pure except the single module-level draft at the bottom,
 * which is kept explicit so swapping it for real persistence is a small change.
 */

export type OrderStage =
  /** Browsing. No account linked yet. */
  | 'searching'
  /** A session is linked; the store knows who the user is. */
  | 'linked'
  /** A delivery address has been given. */
  | 'addressed'
  /** Items are in the user's real cart at the store. */
  | 'cart_built'
  /** The checkout was driven to the payment step and a total was shown. */
  | 'reviewed';

/** Ordered. A stage implies every stage before it. */
export const STAGES: readonly OrderStage[] = [
  'searching',
  'linked',
  'addressed',
  'cart_built',
  'reviewed',
];

export const stageIndex = (s: OrderStage): number => STAGES.indexOf(s);
export const atLeast = (current: OrderStage, needed: OrderStage): boolean =>
  stageIndex(current) >= stageIndex(needed);

/** The tool that gets you from the stage before to the stage named. */
const REACHED_BY: Record<OrderStage, string> = {
  searching: 'search_products',
  linked: 'link_marketplace_account',
  addressed: 'set_delivery_address',
  cart_built: 'build_cart',
  reviewed: 'review_order',
};

/** What each gated tool needs to have happened first. */
export const REQUIRES: Record<string, OrderStage> = {
  set_delivery_address: 'linked',
  build_cart: 'addressed',
  review_order: 'cart_built',
};

export class OrderStateError extends Error {
  constructor(
    readonly tool: string,
    readonly needed: OrderStage,
    readonly current: OrderStage,
    message: string,
  ) {
    super(message);
    this.name = 'OrderStateError';
  }
}

export interface OrderDraft {
  stage: OrderStage;
  address?: DeliveryAddress;
  orderFormId?: string;
  /** What review_order showed. */
  totalCentavos?: Centavos;
  cartUrl?: string;
}

/** Pure: may this tool run from this draft? */
export function checkTransition(tool: string, draft: OrderDraft): void {
  const needed = REQUIRES[tool];
  if (!needed) return;

  if (!atLeast(draft.stage, needed)) {
    throw new OrderStateError(
      tool,
      needed,
      draft.stage,
      `${tool} needs '${needed}' first. You are at '${draft.stage}'. ` +
        `Run ${REACHED_BY[needed]} before this.`,
    );
  }
}

/** Advance, never backwards: a later stage is never silently un-done. */
export function advance(draft: OrderDraft, to: OrderStage): OrderDraft {
  return atLeast(draft.stage, to) ? draft : { ...draft, stage: to };
}

/**
 * Changing the cart invalidates the total that was shown for it. Anything
 * that mutates items must call this, or a user could be shown one basket and
 * then another under the same review.
 */
export function invalidateApprovals(draft: OrderDraft): OrderDraft {
  if (!atLeast(draft.stage, 'reviewed')) return draft;
  return {
    ...draft,
    stage: 'cart_built',
    totalCentavos: undefined,
  };
}

// ---- the single live draft -------------------------------------------------

let draft: OrderDraft = { stage: 'searching' };

export const getDraft = (): OrderDraft => draft;
export const setDraft = (next: OrderDraft): OrderDraft => (draft = next);
export const updateDraft = (patch: Partial<OrderDraft>): OrderDraft => (draft = { ...draft, ...patch });
export const resetOrder = (): OrderDraft => (draft = { stage: 'searching' });

/** Guard + mutate in one call, for the tool handlers. */
export function requireStage(tool: string): OrderDraft {
  checkTransition(tool, draft);
  return draft;
}

export function describeDraft(d: OrderDraft = draft): string {
  const lines = [`Stage: ${d.stage}`];
  if (d.address) lines.push(`Address: ${d.address.street} ${d.address.number}, CP ${d.address.postalCode}`);
  if (d.orderFormId) lines.push(`Cart: ${d.orderFormId}`);
  if (d.totalCentavos !== undefined) lines.push(`Reviewed total: ${formatARS(d.totalCentavos)}`);
  return lines.join('\n');
}
