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

/** An empty pane under a live shop reopens that chat. A reload has no id yet. */
export function restoreActiveChat(args: {
  activeChatId: string | null;
  blockCount: number;
  pending: boolean;
}): boolean {
  return Boolean(args.activeChatId) && args.blockCount === 0 && !args.pending;
}
