import { randomUUID } from 'node:crypto';

import type { Cart, LocationContext } from './types.js';
import { getAdapter } from './adapters/registry.js';

/** Which chain the shopper chose for this basket. Absent until they pick. */
export type OrderRetailer = 'dia' | 'coto';

/** A Coto line is an id and a quantity. The price is looked up, never stored. */
export interface CotoLineSnap {
  id: string;
  quantity: number;
}

/**
 * Per-session state.
 *
 * Over stdio one process serves exactly one user, so this was a module-level
 * store. A web host is the opposite: one process serves many users at once,
 * and a shared `location` means two shoppers silently overwrite each other's
 * supermarket. So the state is a value now, and the module-level one is just
 * the default instance the stdio binary uses.
 *
 * `snapshot`/`restore` exist because a serverless instance is not durable. The
 * cart lives at the retailer under an id we hold; lose the id and `ensureCart`
 * quietly mints an empty replacement and hands the user a link to it. That is
 * a wrong answer with no error, which is the worst kind, so the id has to
 * survive the process that created it.
 */
export interface SessionSnapshot {
  location?: LocationContext;
  /** retailer id -> cart id. A Coto basket's id is `coto-<uuid>` under `coto`. */
  carts: Record<string, string>;
  /**
   * The chain this order belongs to. Optional, like `drawn`: a snapshot from
   * before the field existed restores as today.
   */
  order?: OrderRetailer;
  /** Coto lines. Absent when the basket is empty. */
  coto?: CotoLineSnap[];
}

export interface SessionState {
  setLocation(ctx: LocationContext): void;
  requireLocation(): LocationContext;
  getLocation(): LocationContext | undefined;
  ensureCart(): Promise<{ cart: Cart; ctx: LocationContext }>;
  rememberCart(retailer: string, cartId: string): void;
  getOrder(): OrderRetailer | undefined;
  cotoLines(): CotoLineSnap[];
  setCotoLines(lines: readonly CotoLineSnap[]): void;
  /** Stable `coto-<uuid>`, minted the first time a Coto basket needs one. */
  cotoCartId(): string;
  /**
   * Point the order at `next`. When the current basket has lines and `next`
   * is the other chain, `replace` has to be set or this returns
   * `needs_replace` and changes nothing. `replace` drops the side being left:
   * the Día cart id, or the Coto lines. Lines are never merged.
   * `hasLines` is computed by the caller so this stays free of a store call.
   */
  chooseOrder(
    next: OrderRetailer,
    opts?: { replace?: boolean; hasLines?: boolean },
  ): 'set' | 'replaced' | 'needs_replace';
  snapshot(): SessionSnapshot;
  restore(snap: SessionSnapshot): void;
}

function copyCoto(lines: readonly CotoLineSnap[]): CotoLineSnap[] {
  return lines.map((line) => ({ id: line.id, quantity: line.quantity }));
}

export function createSessionState(): SessionState {
  let location: LocationContext | undefined;
  let order: OrderRetailer | undefined;
  let cotoLines: CotoLineSnap[] = [];
  const carts = new Map<string, string>();

  const cotoCartId = (): string => {
    const existing = carts.get('coto');
    if (existing && existing.startsWith('coto-')) return existing;
    const id = `coto-${randomUUID()}`;
    carts.set('coto', id);
    return id;
  };

  const requireLocation = (): LocationContext => {
    if (!location) {
      throw new Error(
        'No location set. Call set_location with a retailer and an Argentine postal code first — ' +
          'prices and stock in Argentina vary by branch, so results are meaningless without it.',
      );
    }
    return location;
  };

  return {
    setLocation(ctx) {
      if (location && location.retailer !== ctx.retailer) {
        // Prices and cart ids are per-retailer; keeping old carts around invites
        // handing the user a link to a cart from a different supermarket.
        carts.clear();
        order = undefined;
        cotoLines = [];
      }
      location = ctx;
    },

    requireLocation,
    getLocation: () => location,

    /** Returns the current cart for the active retailer, creating one on first use. */
    async ensureCart() {
      const ctx = requireLocation();
      const adapter = getAdapter(ctx.retailer);
      const existing = carts.get(ctx.retailer);
      if (existing) {
        try {
          return { cart: await adapter.getCart(existing, ctx), ctx };
        } catch {
          carts.delete(ctx.retailer); // stale or expired — fall through and make a new one
        }
      }
      const cart = await adapter.createCart(ctx);
      carts.set(ctx.retailer, cart.cartId);
      return { cart, ctx };
    },

    rememberCart(retailer, cartId) {
      carts.set(retailer, cartId);
    },

    getOrder: () => order,

    cotoLines: () => copyCoto(cotoLines),

    setCotoLines(lines) {
      cotoLines = lines.map((line) => {
        const id = line.id.trim();
        if (!id || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
          throw new Error('coto line');
        }
        return { id, quantity: line.quantity };
      });
    },

    cotoCartId,

    chooseOrder(next, opts = {}) {
      const replace = opts.replace === true;
      const hasLines = opts.hasLines === true;
      if (order && order !== next) {
        if (hasLines && !replace) return 'needs_replace';
        if (replace) {
          if (order === 'dia') carts.delete('dia');
          else cotoLines = [];
        }
        order = next;
        if (next === 'coto') cotoCartId();
        return replace ? 'replaced' : 'set';
      }
      order = next;
      if (next === 'coto') cotoCartId();
      return 'set';
    },

    snapshot: () => ({
      location,
      carts: Object.fromEntries(carts),
      ...(order ? { order } : {}),
      ...(cotoLines.length ? { coto: copyCoto(cotoLines) } : {}),
    }),

    restore(snap) {
      location = snap.location;
      carts.clear();
      for (const [retailer, cartId] of Object.entries(snap.carts ?? {})) {
        carts.set(retailer, cartId);
      }
      order = snap.order === 'dia' || snap.order === 'coto' ? snap.order : undefined;
      cotoLines = Array.isArray(snap.coto)
        ? snap.coto.flatMap((line) => {
            if (!line || typeof line.id !== 'string') return [];
            const id = line.id.trim();
            if (!id || !Number.isSafeInteger(line.quantity) || line.quantity < 1) return [];
            return [{ id, quantity: line.quantity }];
          })
        : [];
    },
  };
}

/**
 * The instance the stdio binary and the checkout tools use. Keeping these
 * free functions means `tools.ts` and every existing test compile unchanged;
 * only a host that needs more than one session has to know about the factory.
 */
export const defaultSession: SessionState = createSessionState();

export const setLocation = (ctx: LocationContext): void => defaultSession.setLocation(ctx);
export const requireLocation = (): LocationContext => defaultSession.requireLocation();
export const getLocation = (): LocationContext | undefined => defaultSession.getLocation();
export const ensureCart = (): Promise<{ cart: Cart; ctx: LocationContext }> =>
  defaultSession.ensureCart();
export const rememberCart = (retailer: string, cartId: string): void =>
  defaultSession.rememberCart(retailer, cartId);
