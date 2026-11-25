import type Anthropic from '@anthropic-ai/sdk';
import type { Cart, Product } from '@changuito/mcp/types';

import type { CompareCard, UiEvent } from '../protocol';

/**
 * Tools the model calls to draw things, which never reach the MCP server.
 *
 * Splitting "what the data is" from "show it" is the whole design. A tool
 * result is data: `search_products` returns twelve items whether the model
 * recommends three or none of them. Which ones to surface is a decision, and
 * a decision has to be a call.
 *
 * The inputs are identifiers only — never a price, never a name. The model
 * picks SKUs; the server looks up what they cost. That is the difference
 * between a grid that is wrong and a grid that cannot be wrong, and it matters
 * most directly above a button that spends money.
 */

/** Filled from `structuredContent` as tools return, so renders can hydrate. */
export interface RenderCache {
  products: Map<string, Product>;
  cart?: Cart;
  handoffUrl?: string;
  /**
   * Which cart `handoffUrl` opens.
   *
   * The URL carries a cart id (`?orderFormId=…#/cart`), so a link held past a
   * change of basket — a different retailer, a cart the store replaced — opens
   * the wrong one. `get_cart_link` is the single moment the pairing is known,
   * because it returns the link and the cart together, so it is recorded there
   * rather than inferred later from the string.
   */
  handoffFor?: string;
  /**
   * Fingerprint of the cart card last drawn. An unchanged basket is not worth
   * a second card; a changed one is worth it without being asked for.
   */
  drawn?: string;
  /**
   * Fingerprint of the Día vs Coto card last compared, and the card itself.
   * Optional, like `drawn`: a version bump would drop every conversation in
   * flight. A later turn with the same fingerprint re-emits `compareResult`
   * and does not call Coto.
   */
  compareFor?: string;
  compareResult?: CompareCard;
  /**
   * `chat_dual_checkout_demo` for this hop. Set in the loop before the cart
   * is drawn, and not written into the stored turn: the next hop reads it again.
   */
  dualCheckout?: boolean;
  /**
   * Solo Día: dual demo is on but Coto search is disabled. The cart PayCard
   * still prices the 20% gap fee (feeBasis other_disabled → 0).
   */
  soloDia?: boolean;
  /**
   * Coto hits from search-time compare, keyed by id. A plain record so the
   * turn-store codec carries it without a Map special case.
   */
  coto?: Record<string, CotoCacheItem>;
  /** Queries searched this turn, and how many available hits came back. */
  searches?: SearchRecord[];
}

/** A Coto catalog row the render tools may cite. Prices stay off the model input. */
export interface CotoCacheItem {
  id: string;
  name: string;
  shelfCentavos: number;
  available: boolean;
  ean?: string;
  brand?: string;
  url?: string;
  imageUrl?: string;
}

export interface SearchRecord {
  query: string;
  retailer: 'dia' | 'coto';
  available: number;
}

export const emptyCache = (): RenderCache => ({ products: new Map() });

/** Absorb whatever structure a tool result carried. Unknown shapes are ignored. */
export function rememberStructured(cache: RenderCache, structured: unknown): void {
  if (!structured || typeof structured !== 'object') return;
  const s = structured as { products?: Product[]; cart?: Cart; handoffUrl?: string };

  for (const p of s.products ?? []) cache.products.set(p.skuId, p);

  if (s.cart) {
    cache.cart = s.cart;
    // A cart's lines are the freshest prices there are — the store just quoted
    // them — so they win over an older search result for the same SKU.
    for (const line of s.cart.lines) {
      const known = cache.products.get(line.skuId);
      if (known) cache.products.set(line.skuId, { ...known, price: line.unitPrice });
    }
  }
  if (s.handoffUrl) {
    cache.handoffUrl = s.handoffUrl;
    // Recorded now, while the pairing is still in front of us. `cache.cart` is
    // already the newer one — the block above ran first — so a link that
    // arrived with its own cart is pinned to that, and one that arrived alone
    // to whatever we are holding.
    cache.handoffFor = s.cart?.cartId ?? cache.cart?.cartId;
  }
}

/** The handoff link, but only when it opens the basket we are holding. */
export function cartLink(cache: RenderCache): string | undefined {
  return cache.cart && cache.handoffFor === cache.cart.cartId ? cache.handoffUrl : undefined;
}

/**
 * Everything a cart card puts on screen, as one string.
 *
 * Two carts with the same fingerprint would draw the same card, so there is
 * nothing to redraw. The total alone is not enough: swapping a line for another
 * of the same price changes the card and not the total.
 */
function cardPrint(cart: Cart, handoffUrl?: string): string {
  const lines = cart.lines.map(
    (l) => `${l.index}:${l.skuId}:${l.quantity}:${l.lineTotal.centavos}:${l.available ? 1 : 0}`,
  );
  return [cart.cartId, cart.total.centavos, handoffUrl ?? '', ...lines, ...cart.messages].join('|');
}

/**
 * Draw the basket because it changed, not because the model remembered to ask.
 *
 * ## Why this one is not a decision the model makes
 *
 * The rule above — a render tool exists because *which* products to surface is
 * a decision — is about a set of twelve search results and three
 * recommendations. The cart is not that. There is exactly one, the user put it
 * there, and its current contents are not a choice anybody is making.
 *
 * Leaving it to the model went wrong in the way that was predictable in
 * hindsight: asked to change something, it changed it and then pointed at the
 * card already on screen — the old lines, the old total, the same link — rather
 * than drawing the new one. Which was *true*, because the link is derived from
 * the cart id and does not move, and useless, because the products and the
 * amount above the pay button were the ones from before.
 *
 * So the card follows the basket. A changed cart draws; an unchanged one does
 * not, however many tools mention it. The reducer in lib/chat-state.ts keys the
 * card on the cart id within the turn and updates it in place, so drawing again
 * replaces the card rather than stacking a second one under it.
 *
 * Nothing is drawn before there is a link that belongs to this cart: a card
 * whose only actionable control is missing is the case CLAUDE.md §2 warns
 * about, and the first `get_cart_link` of a basket is moments away anyway.
 */
export function autoRenderCart(cache: RenderCache, emit: (e: UiEvent) => void): boolean {
  const cart = cache.cart;
  if (!cart || !cart.lines.length) return false;
  // A Coto basket has no store link and no pay control. Drawing it without a
  // link does not reopen the Día bug: that bug was a card whose only action
  // was missing. This card is not allowed to spend anything.
  const cotoBasket = cart.retailer === 'coto';
  const handoffUrl = cotoBasket ? undefined : cartLink(cache);
  if (!cotoBasket && !handoffUrl) return false;

  const print = cardPrint(cart, handoffUrl);
  if (print === cache.drawn) return false;

  cache.drawn = print;
  emit({
    t: 'cart',
    cart,
    ...(handoffUrl ? { handoffUrl } : {}),
    ...(cotoBasket ? { orderable: false } : {}),
    ...(cache.dualCheckout ? { dualCheckout: true } : {}),
    ...(cache.soloDia ? { soloDia: true } : {}),
  });
  return true;
}

/** Dual search is on and the shopper has not picked a chain yet. */
export function cartWriteNeedsChoice(dual: boolean, order: string | undefined): boolean {
  return dual && order !== 'dia' && order !== 'coto';
}

/**
 * An id that is known only on the other chain. An id known on neither is left
 * to the cart tool, which rejects a Coto id that is not an exact catalog match.
 */
export function foreignCartSku(
  order: 'dia' | 'coto',
  skuId: string,
  diaIds: ReadonlySet<string>,
  cotoIds: ReadonlySet<string>,
): boolean {
  const onDia = diaIds.has(skuId);
  const onCoto = cotoIds.has(skuId);
  if (order === 'dia') return onCoto && !onDia;
  return onDia && !onCoto;
}

const DIA_NAME = /d[ií]a/i;
const COTO_NAME = /\bcoto\b/i;

export function textNamesRetailer(text: string, retailer: 'dia' | 'coto'): boolean {
  return (retailer === 'dia' ? DIA_NAME : COTO_NAME).test(text);
}

/** The shopper named the store, or the question immediately before them did. */
export function shopperNamedRetailer(
  retailer: 'dia' | 'coto',
  userText: string,
  priorAssistant: string,
): boolean {
  return textNamesRetailer(userText, retailer) || textNamesRetailer(priorAssistant, retailer);
}

/** A query searched this turn on that retailer that returned no available hit. */
export function searchedEmpty(cache: RenderCache, query: string, retailer: 'dia' | 'coto'): boolean {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return false;
  const rows = cache.searches ?? [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.retailer !== retailer) continue;
    if (row.query.trim().toLowerCase() !== wanted) continue;
    return row.available === 0;
  }
  return false;
}

export const RENDER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'render_products',
    description:
      'Show product cards to the user. Pass only the SKUs you are actually recommending — ' +
      'the UI draws them, so do not also list them in prose. Call this for EVERY search whose ' +
      'results you mention, with the SKUs from that search: a second page, another brand, a ' +
      'replacement for something out of stock. A product the user has only read the name of is ' +
      'one they cannot see, and they should never have to ask for the pictures. Prices and ' +
      'names come from the last search; you do not supply them.',
    input_schema: {
      type: 'object',
      properties: {
        sku_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'SKU ids from a previous search_products or price_check result.',
          minItems: 1,
        },
        note: {
          type: 'string',
          description: 'One short line above the grid, e.g. "la opción más barata por litro".',
        },
      },
      required: ['sku_ids'],
    },
  },
  {
    name: 'render_cart',
    description:
      'Show the current cart as a card, with the total and the link that opens it in the ' +
      "supermarket's own site. You rarely need this: once get_cart_link has run, the card is " +
      'drawn for you every time the cart changes, with the new lines, the new total and the ' +
      'link. Call this only to bring an unchanged basket back on screen — after a question ' +
      'about it, say. Never answer a change by pointing at a card already on screen.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'render_missing',
    description:
      'Tell the shopper a requested item is missing on the store they picked, and ask them to ' +
      'substitute or drop it. Pass the query you searched and the retailer (dia or coto). ' +
      'The server accepts it only when that query was searched this turn on that store and ' +
      'returned no available product. Do not drop the item silently and do not fill it from ' +
      'the other chain. You do not supply a price or a product name.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query that returned nothing available.' },
        retailer: { type: 'string', enum: ['dia', 'coto'], description: 'The store the shopper picked.' },
      },
      required: ['query', 'retailer'],
    },
  },
];

export const RENDER_TOOL_NAMES = new Set(RENDER_TOOLS.map((t) => t.name));

export function runRenderTool(
  cache: RenderCache,
  use: { id: string; name: string; input: unknown },
  emit: (e: UiEvent) => void,
): Anthropic.ToolResultBlockParam {
  const result = (content: string, isError = false): Anthropic.ToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: use.id,
    content,
    is_error: isError || undefined,
  });

  if (use.name === 'render_products') {
    const ids = ((use.input as { sku_ids?: unknown })?.sku_ids ?? []) as string[];
    const note = (use.input as { note?: string })?.note;

    const items = ids.map((id) => cache.products.get(id)).filter((p): p is Product => Boolean(p));
    const missing = ids.filter((id) => !cache.products.has(id));

    if (!items.length) {
      // Refusing beats rendering a plausible guess: an invented SKU is an
      // invented price.
      return result(
        `None of those SKUs came from a search in this conversation: ${missing.join(', ')}. ` +
          'Call search_products first and use the sku= values it returns.',
        true,
      );
    }

    emit({ t: 'products', items, note });
    return result(
      `Rendered ${items.length} product card(s).` +
        (missing.length ? ` Skipped unknown SKUs: ${missing.join(', ')}.` : ''),
    );
  }

  if (use.name === 'render_cart') {
    if (!cache.cart) {
      return result('No cart yet. Call view_cart or add_to_cart first.', true);
    }
    const cotoBasket = cache.cart.retailer === 'coto';
    const handoffUrl = cotoBasket ? undefined : cartLink(cache);
    // Recorded as drawn so the automatic render does not immediately repeat
    // what this call just put on screen.
    cache.drawn = cardPrint(cache.cart, handoffUrl);
    emit({
      t: 'cart',
      cart: cache.cart,
      ...(handoffUrl ? { handoffUrl } : {}),
      ...(cotoBasket ? { orderable: false } : {}),
      ...(cache.dualCheckout ? { dualCheckout: true } : {}),
      ...(cache.soloDia ? { soloDia: true } : {}),
    });
    return result(`Rendered the cart: ${cache.cart.lines.length} line(s), ${cache.cart.total.display}.`);
  }

  if (use.name === 'render_missing') {
    const query = (use.input as { query?: unknown })?.query;
    const retailer = (use.input as { retailer?: unknown })?.retailer;
    if (typeof query !== 'string' || (retailer !== 'dia' && retailer !== 'coto')) {
      return result('render_missing needs a query and retailer dia or coto.', true);
    }
    if (!searchedEmpty(cache, query, retailer)) {
      return result(
        'That query was not searched on that store in this turn, or it returned an available product. ' +
          'Search it there first, and only call this when nothing available comes back.',
        true,
      );
    }
    const item = query.trim();
    emit({ t: 'missing', query: item, retailer, item });
    return result(`Told the shopper that "${item}" is missing at ${retailer}.`);
  }

  return result(`Unknown render tool ${use.name}.`, true);
}
