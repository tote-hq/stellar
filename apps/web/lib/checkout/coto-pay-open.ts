/**
 * Whether Proceder al pago can open the Coto modal, and whether a remounted
 * pane should reopen the active chat.
 *
 * The session id is chosen here, never typed into the modal by the caller.
 * No relative imports: the test loads this file under strip-types.
 */

export interface CotoOpenCart {
  retailer: string;
}

/** True only when a signed-in read-only Coto chat may ask the resume route. */
export function cotoResumeProbe(args: {
  readOnly: boolean;
  retailer: string | null | undefined;
  orderState: string | null | undefined;
  address: string | null | undefined;
}): boolean {
  return Boolean(args.readOnly && args.retailer === 'coto' && args.orderState !== 'paid' && args.address);
}

/**
 * The session id a pay click may hand the modal.
 * A resumable chat uses its stored id. A read-only chat uses it only when an
 * open order was confirmed. The id is never invented here.
 */
export function cotoSessionFor(args: {
  resumable: boolean;
  resumeOrderId: string | null;
  storedSessionId: string | null;
}): string | null {
  if (!args.storedSessionId) return null;
  if (args.resumable || args.resumeOrderId) return args.storedSessionId;
  return null;
}

export function cotoPayOpen<T extends CotoOpenCart>(args: {
  cart: T | null | undefined;
  sessionId: string | null;
  storedSessionId: string | null;
}): { cart: T; sessionId: string } | null {
  if (args.cart?.retailer !== 'coto') return null;
  const sessionId = args.sessionId || args.storedSessionId;
  if (!sessionId) return null;
  return { cart: args.cart, sessionId };
}

export interface OpenCotoRow {
  orderId: string;
  buyer?: string;
  checkoutKind?: string;
  openSig?: string;
  jobId?: string;
  outcome?: string;
  createdAt?: number;
  fulfillment?: string;
}

/**
 * The open coto_real_v1 order this buyer can return to.
 * The newest createdAt wins. A quoted, settled, refunded, or jobless row is not open.
 */
export function openCotoOrder(rows: readonly OpenCotoRow[], buyer: string): { orderId: string; fulfillment: 'home' | 'pickup' } | null {
  let newest: OpenCotoRow | null = null;
  for (const row of rows) {
    if (row.checkoutKind !== 'coto_real_v1') continue;
    if (row.buyer !== buyer) continue;
    if (!row.openSig) continue;
    if (!row.jobId || row.jobId === 'none') continue;
    if (row.outcome) continue;
    if (!newest || (row.createdAt ?? 0) > (newest.createdAt ?? 0)) newest = row;
  }
  if (!newest) return null;
  return {
    orderId: newest.orderId,
    fulfillment: newest.fulfillment === 'pickup' ? 'pickup' : 'home',
  };
}

/** An empty pane under a live shop reopens that chat. A reload has no id yet. */
export function restoreActiveChat(args: {
  activeChatId: string | null;
  blockCount: number;
  pending: boolean;
}): boolean {
  return Boolean(args.activeChatId) && args.blockCount === 0 && !args.pending;
}
