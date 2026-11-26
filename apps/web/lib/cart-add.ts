/**
 * Add the product on a card the shopper clicked.
 *
 * The client sends a chain and an id. The price, the name and the quantity
 * are not arguments: quantity is 1, and the line is priced from the catalog
 * the turn already holds. A click names the store, so an unset order calls
 * `choose_retailer` before the add.
 */
import type { SessionSnapshot } from '@changuito/mcp/session';

import type { RenderCache } from './agent/render-tools.ts';
import { autoRenderCart, foreignCartSku, rememberStructured, type CotoCacheItem } from './agent/render-tools.ts';
import { chainChoiceOn } from './agent/search-compare.ts';
import { freezeAllowed } from './checkout/coto-real.ts';
import type { UiEvent } from './protocol.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CartAddCall {
  isError: boolean;
  structured?: unknown;
  message?: string;
}

export interface ParsedCartAdd {
  sessionId: string;
  chain: 'dia' | 'coto';
  id: string;
  snapshot?: SessionSnapshot;
  network?: unknown;
}

export type ParseCartAdd =
  | { ok: true; body: ParsedCartAdd }
  | { ok: false; status: number; error: string };

/**
 * Keep `chain` and `id`. A `price`, a `name` or a `quantity` on the body
 * is dropped here, before any cart write.
 */
export function parseCartAddBody(raw: unknown): ParseCartAdd {
  if (!raw || typeof raw !== 'object') return { ok: false, status: 400, error: 'invalid_body' };
  const body = raw as Record<string, unknown>;
  if (typeof body.sessionId !== 'string' || !UUID.test(body.sessionId)) {
    return { ok: false, status: 400, error: 'invalid_session' };
  }
  if (body.chain !== 'dia' && body.chain !== 'coto') return { ok: false, status: 400, error: 'invalid_chain' };
  if (typeof body.id !== 'string' || !body.id || body.id.length > 64) {
    return { ok: false, status: 400, error: 'invalid_id' };
  }
  const snapshot =
    body.snapshot && typeof body.snapshot === 'object' ? (body.snapshot as SessionSnapshot) : undefined;
  return {
    ok: true,
    body: {
      sessionId: body.sessionId,
      chain: body.chain,
      id: body.id,
      ...(snapshot ? { snapshot } : {}),
      ...(body.network !== undefined ? { network: body.network } : {}),
    },
  };
}

export interface CartAddSession {
  state: {
    getOrder(): 'dia' | 'coto' | undefined;
    getLocation(): { retailer?: string } | undefined;
    snapshot(): SessionSnapshot;
  };
}

export type CartAddResult =
  | { ok: true; event: Extract<UiEvent, { t: 'cart' }> | null; snapshot: SessionSnapshot }
  | { ok: false; status: number; error: string };

export async function addCardToCart(args: {
  session: CartAddSession;
  cache: RenderCache;
  chain: 'dia' | 'coto';
  id: string;
  owner: string | null;
  compareOn: boolean;
  cotoEnabled: boolean;
  /**
   * A turn the store did not have. A Día id is validated by `add_to_cart`.
   * A Coto id is priced through `catalog` first.
   */
  freshTurn?: boolean;
  catalog?: {
    getProduct(id: string): Promise<CotoCacheItem | null>;
  };
  call: (name: string, input: Record<string, unknown>) => Promise<CartAddCall>;
}): Promise<CartAddResult> {
  const diaIds = new Set(args.cache.products.keys());
  const cotoIds = new Set(Object.keys(args.cache.coto ?? {}));
  const onThisChain = args.chain === 'dia' ? diaIds.has(args.id) : Boolean(args.cache.coto?.[args.id]);
  let diaFromTool = false;
  if (!onThisChain) {
    if (foreignCartSku(args.chain, args.id, diaIds, cotoIds)) {
      return { ok: false, status: 409, error: 'foreign_cart' };
    }
    if (args.chain === 'coto' && args.catalog) {
      let item: CotoCacheItem | null;
      try {
        item = await args.catalog.getProduct(args.id);
      } catch {
        return { ok: false, status: 502, error: 'add_failed' };
      }
      if (!item) return { ok: false, status: 400, error: 'unknown_product' };
      args.cache.coto = { ...(args.cache.coto ?? {}), [item.id]: item, [args.id]: item };
    } else if (args.chain === 'dia' && args.freshTurn) {
      diaFromTool = true;
    } else {
      return { ok: false, status: 400, error: 'unknown_product' };
    }
  }

  if (args.chain === 'coto' && !freezeAllowed(args.cache.cotoRealDia, args.owner)) {
    return { ok: false, status: 403, error: 'freeze_denied' };
  }

  const cart = args.cache.cart;
  if (
    cart &&
    cart.lines.length > 0 &&
    cart.retailer !== args.chain &&
    (cart.retailer === 'dia' || cart.retailer === 'coto')
  ) {
    return { ok: false, status: 409, error: 'switch_required' };
  }

  const order = args.session.state.getOrder();
  const choiceOn = chainChoiceOn({
    compareOn: args.compareOn,
    cotoEnabled: args.cotoEnabled,
    retailer: args.session.state.getLocation()?.retailer,
  });
  if (order !== args.chain) {
    if (order === undefined && !choiceOn && args.chain === 'dia') {
      // The session is already Día. There is no chain to record.
    } else if (order === undefined && !choiceOn) {
      return { ok: false, status: 409, error: 'choose_required' };
    } else {
      const chosen = await args.call('choose_retailer', { retailer: args.chain });
      if (chosen.isError) return { ok: false, status: 409, error: 'choose_failed' };
    }
  }

  const seller = args.cache.products.get(args.id)?.sellerId || '1';
  const added = await args.call('add_to_cart', {
    items: [{ sku_id: args.id, quantity: 1, seller_id: seller }],
  });
  if (added.isError) {
    const missing = diaFromTool && /not found|unknown sku|no existe/i.test(added.message ?? '');
    return { ok: false, status: missing ? 400 : 502, error: missing ? 'unknown_product' : 'add_failed' };
  }
  rememberStructured(args.cache, added.structured);

  const cartId = args.cache.cart?.cartId;
  if (args.chain === 'dia' && cartId && args.cache.handoffFor !== cartId) {
    const link = await args.call('get_cart_link', {});
    if (!link.isError) rememberStructured(args.cache, link.structured);
  }

  let event: Extract<UiEvent, { t: 'cart' }> | null = null;
  autoRenderCart(args.cache, (next) => {
    if (next.t === 'cart') event = next;
  });
  return { ok: true, event, snapshot: args.session.state.snapshot() };
}
