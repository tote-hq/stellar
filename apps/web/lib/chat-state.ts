import type { Cart, Product } from '@changuito/mcp/types';
import type { SessionSnapshot } from '@changuito/mcp/session';

import type { ChatImage } from './chat-image.ts';
import type { CompareCard, CompareLineView, SearchCompareItem, SearchCompareStatus, TurnStage, UiEvent } from './protocol';

/**
 * The transcript, as a reducer over UiEvents.
 *
 * Pure and framework-free so the ordering rules can be tested without a
 * browser. The ordering is the whole difficulty: a product grid arrives in
 * the middle of a sentence, and if it is appended to the end of the turn the
 * user reads "acá están los precios" above nothing, then a grid below the
 * paragraph that was supposed to follow it.
 */

export interface ToolRun {
  id: string;
  name: string;
  ms?: number;
  ok?: boolean;
}

/**
 * A card click landed a cart the model did not stream.
 *
 * The newest block for this cart id is replaced in place, anywhere in the
 * transcript, so the rail and the thread stay on the same basket. A cart the
 * shopper has not seen yet is appended. A link already on the card stays.
 */
export function cartAdded(
  state: ChatState,
  event: Extract<UiEvent, { t: 'cart' }>,
  snapshot: SessionSnapshot | undefined,
): ChatState {
  let existing = -1;
  for (let i = state.blocks.length - 1; i >= 0; i -= 1) {
    const block = state.blocks[i];
    if (block && block.kind === 'cart' && block.cart.cartId === event.cart.cartId) {
      existing = i;
      break;
    }
  }
  const prior = existing === -1 ? undefined : (state.blocks[existing] as Extract<Block, { kind: 'cart' }>);
  const handoffUrl = event.handoffUrl ?? prior?.handoffUrl;
  const block: Extract<Block, { kind: 'cart' }> = {
    kind: 'cart',
    id: prior?.id ?? nextId(),
    cart: event.cart,
    ...(handoffUrl ? { handoffUrl } : {}),
    ...(event.dualCheckout ? { dualCheckout: true } : {}),
    ...(event.soloDia ? { soloDia: true } : {}),
    ...(event.orderable === false ? { orderable: false } : {}),
  };
  const blocks = prior
    ? state.blocks.map((item, index) => (index === existing ? block : item))
    : [...state.blocks, block];
  return {
    ...state,
    blocks,
    ...(snapshot ? { snapshot } : {}),
    cart: {
      cart: event.cart,
      ...(handoffUrl ? { handoffUrl } : {}),
      ...(event.dualCheckout ? { dualCheckout: true } : {}),
      ...(event.soloDia ? { soloDia: true } : {}),
    },
  };
}

/** Body of POST /api/cart/add. `event` is null when the line was written and nothing new was drawn. */
export interface CartAddReply {
  ok?: boolean;
  event?: Extract<UiEvent, { t: 'cart' }> | null;
  snapshot?: SessionSnapshot;
}

export interface CartAddReplyApplied {
  result: 'added' | 'failed';
  /** What the next request must send. Unchanged when the add did not succeed. */
  snapshot: SessionSnapshot | undefined;
  apply: (state: ChatState) => ChatState;
}

/**
 * What a card-click response does to the session and the transcript.
 *
 * A 200 with `ok: true` already wrote the line, including when `autoRenderCart`
 * drew nothing (`event` is null — a Día basket whose link call failed). The
 * snapshot still has to land, or the next chat turn rebuilds the MCP session
 * without that cart id. A missing card is not a failure: the shopper must not
 * see "could not add" for a line that is in the basket, and a retry would add
 * it again. `ok: false` and a non-2xx response leave the snapshot and the
 * transcript untouched.
 */
export function applyCartAddReply(
  held: SessionSnapshot | undefined,
  httpOk: boolean,
  body: CartAddReply | null,
): CartAddReplyApplied {
  if (!httpOk || !body || body.ok !== true) {
    return { result: 'failed', snapshot: held, apply: (state) => state };
  }
  const snapshot = body.snapshot ? body.snapshot : held;
  const event = body.event && body.event.t === 'cart' ? body.event : null;
  return {
    result: 'added',
    snapshot,
    apply: (state) => {
      if (event) return cartAdded(state, event, snapshot);
      if (snapshot === undefined || state.snapshot === snapshot) return state;
      return { ...state, snapshot };
    },
  };
}

/**
 * Why a turn never landed.
 *
 * `login` is the only one worth resuming on its own: the gate is a door the
 * user can open, and once it is open the same message is still what they meant
 * to say. Everything else needs a human to decide whether to try again.
 *
 * `dropped` is a `network` failure after the server said `received`: the
 * message did get there, the answer never came back. Retrying is just as safe
 * — history is written only on a clean return — but "no se envió" would be
 * untrue, so the copy differs.
 */
export type SendFailure = { reason: 'login' | 'network' | 'dropped'; message: string };

/** What the server last said it was doing. Absent between turns. */
export interface TurnProgress {
  stage: TurnStage;
  hop: number;
  /** Reply text has arrived since the last status. */
  writing: boolean;
}

export type Block =
  | { kind: 'user'; id: string; text: string; failed?: SendFailure; image?: ChatImage }
  | { kind: 'say'; id: string; text: string; thinking: string; tools: ToolRun[] }
  | { kind: 'products'; id: string; items: Product[]; note?: string }
  | {
      kind: 'cart';
      id: string;
      cart: Cart;
      handoffUrl?: string;
      dualCheckout?: boolean;
      soloDia?: boolean;
      /** False when this basket cannot be paid. A Coto order. */
      orderable?: boolean;
    }
  | {
      kind: 'compare';
      id: string;
      status: 'pending' | CompareCard['status'];
      cartId: string;
      handoffUrl: string;
      matched: number;
      lines: number;
      gap?: CompareCard['gap'];
      rows: CompareLineView[];
      /** Set when this card may offer the dual mock pay. Pending and timed out never do. */
      checkoutDemo?: boolean;
    }
  | {
      kind: 'search_compare';
      id: string;
      /** The server id that pairs pending with the finished card. */
      compareId: string;
      status: SearchCompareStatus;
      query: string;
      postalCode?: string;
      dia: SearchCompareItem[];
      coto: SearchCompareItem[];
      gapCentavos?: number;
      feeCentavos?: number;
      /** Absent means both chains. A block drawn before the field keeps both. */
      chains?: ('dia' | 'coto')[];
      /** The type label from the event's `kind`. Absent on an older block. */
      typeLabel?: string;
      /** Chains with no comparable product. Absent when the row does not say. */
      noPair?: ('dia' | 'coto')[];
    }
  | { kind: 'missing'; id: string; query: string; retailer: 'dia' | 'coto'; item: string }
  | { kind: 'error'; id: string; message: string; recoverable: boolean };

export interface ChatState {
  blocks: Block[];
  /** True between send and `done`. Drives the composer's disabled state. */
  streaming: boolean;
  /** Set by `status` events during a turn, cleared when it ends. */
  progress?: TurnProgress;
  /** Opaque to the browser; handed back on the next turn so the agent remembers. */
  snapshot?: SessionSnapshot;
  /** The newest cart seen, wherever it appeared. What the pay button settles. */
  cart?: { cart: Cart; handoffUrl?: string; dualCheckout?: boolean; soloDia?: boolean };
}

export const initialState: ChatState = { blocks: [], streaming: false };

/** The rail hides its pay control while the dual mock cards are the way to pay. */
export function dualCheckoutOn(state: Pick<ChatState, 'blocks' | 'cart'>): boolean {
  if (state.cart?.dualCheckout) return true;
  for (const block of state.blocks) {
    if (block.kind === 'cart' && block.dualCheckout) return true;
    if (
      block.kind === 'compare' &&
      block.checkoutDemo &&
      (block.status === 'ok' || block.status === 'degraded') &&
      block.matched >= 1
    ) {
      return true;
    }
  }
  return false;
}

let seq = 0;
const nextId = () => `b${++seq}`;

/** Exported for tests, which need ids to be predictable. */
export function resetIds(): void {
  seq = 0;
}

/**
 * Move the counter past ids that already exist.
 *
 * Restoring a transcript from storage brings back blocks named `b1`…`b9`
 * while this counter is still at zero, so the next block minted would be `b1`
 * again. React keys off `id`: a duplicate key does not throw, it silently
 * reuses the wrong node, and the symptom is a new message painting itself
 * into an old bubble. Call this with the highest restored number.
 *
 * It only ever moves forward. A lower number is ignored rather than honoured,
 * because two restores in one page life must not walk the counter backwards
 * into ids the first one already handed out.
 */
export function seedIds(highest: number): void {
  if (Number.isFinite(highest) && highest > seq) seq = Math.floor(highest);
}

/** The number in a `b12` id, or 0 for anything else. */
export function idNumber(id: string): number {
  const m = /^b(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/**
 * Drop a finished `get_cart_link` row once this turn has a cart card.
 *
 * The row is the wait for that card. `autoRenderCart` draws the card itself,
 * and the call that produced the link is often over before a tenth of a
 * second — which the trail used to print as "0.0s", a row that looks like it
 * never closed. The card is the resolution, so the row goes. A failed call
 * stays: hiding the ✗ would make a call that did not work look like one that did.
 *
 * Same scope as the card. A row from an earlier turn is what happened then,
 * and a later cart does not get to edit it. An otherwise empty bubble goes
 * with the row, or the thread keeps a blank agent message.
 */
function withoutCartLinkTrail(blocks: Block[], turnStart: number): Block[] {
  let changed = false;
  const next = blocks.flatMap((b, i) => {
    if (i <= turnStart || b.kind !== 'say') return [b];
    if (!b.tools.some((t) => t.name === 'get_cart_link' && t.ok !== false)) return [b];
    changed = true;
    const tools = b.tools.filter((t) => t.name !== 'get_cart_link' || t.ok === false);
    if (b.text === '' && b.thinking === '' && tools.length === 0) return [];
    return [{ ...b, tools }];
  });
  return changed ? next : blocks;
}

/** The state with no turn in progress. Removes the key rather than setting it undefined. */
function settled(state: ChatState): ChatState {
  if (!('progress' in state)) return state;
  const { progress: _done, ...rest } = state;
  return rest;
}

export function sendUser(state: ChatState, text: string, image?: ChatImage): ChatState {
  const block: Extract<Block, { kind: 'user' }> = image
    ? { kind: 'user', id: nextId(), text, image }
    : { kind: 'user', id: nextId(), text };
  return {
    ...settled(state),
    streaming: true,
    blocks: [...state.blocks, block],
  };
}

/**
 * Append to the open `say` block, or start one. A block stops being open as
 * soon as anything else is appended, which is what keeps text on the correct
 * side of a grid.
 */
function intoSay(blocks: Block[], f: (b: Extract<Block, { kind: 'say' }>) => Extract<Block, { kind: 'say' }>): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'say') return [...blocks.slice(0, -1), f(last)];
  return [...blocks, f({ kind: 'say', id: nextId(), text: '', thinking: '', tools: [] })];
}

/**
 * `Array.prototype.findLastIndex` by hand: the app targets ES2022 and that one
 * is ES2023, so it does not typecheck here.
 */
function lastIndexWhere(blocks: Block[], match: (b: Block, i: number) => boolean): number {
  for (let i = blocks.length - 1; i >= 0; i--) if (match(blocks[i]!, i)) return i;
  return -1;
}

/**
 * The search cards of the turn that owns `index`, in emit order.
 *
 * The turn is the blocks after the user message at or before `index` and
 * before the next user message, the same boundary the cart dedupe uses.
 * Only the first search card of that turn gets the row. Later cards of the
 * turn return `[]`, so the UI draws the row once. A card from an earlier
 * turn is not included: that row stays as it was drawn.
 */
export function searchRowAt(
  blocks: Block[],
  index: number,
): Extract<Block, { kind: 'search_compare' }>[] {
  let turnStart = -1;
  for (let i = Math.min(index, blocks.length - 1); i >= 0; i--) {
    if (blocks[i]?.kind === 'user') {
      turnStart = i;
      break;
    }
  }
  let turnEnd = blocks.length;
  for (let i = turnStart + 1; i < blocks.length; i++) {
    if (blocks[i]?.kind === 'user') {
      turnEnd = i;
      break;
    }
  }
  const row: Extract<Block, { kind: 'search_compare' }>[] = [];
  let first = -1;
  for (let i = turnStart + 1; i < turnEnd; i++) {
    const block = blocks[i];
    if (block?.kind !== 'search_compare') continue;
    if (first === -1) first = i;
    row.push(block);
  }
  if (index !== first) return [];
  return row;
}

export function applyEvent(state: ChatState, e: UiEvent): ChatState {
  switch (e.t) {
    case 'status':
      // A late status after the turn ended (Parar, then a buffered frame)
      // must not bring the waiting row back.
      if (!state.streaming) return state;
      return {
        ...state,
        progress: { stage: e.stage, hop: e.hop ?? state.progress?.hop ?? 0, writing: false },
      };

    case 'text':
      return {
        ...state,
        ...(state.progress && !state.progress.writing ? { progress: { ...state.progress, writing: true } } : {}),
        blocks: intoSay(state.blocks, (b) => ({ ...b, text: b.text + e.delta })),
      };

    case 'thinking':
      return { ...state, blocks: intoSay(state.blocks, (b) => ({ ...b, thinking: b.thinking + e.delta })) };

    case 'tool_start':
      return {
        ...state,
        blocks: intoSay(state.blocks, (b) => ({ ...b, tools: [...b.tools, { id: e.id, name: e.name }] })),
      };

    case 'tool_end':
      // Lands on whichever block holds that call, not necessarily the open one:
      // a search that finishes after a grid was drawn still belongs to its own turn.
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.kind === 'say' && b.tools.some((t) => t.id === e.id)
            ? { ...b, tools: b.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, ms: e.ms } : t)) }
            : b,
        ),
      };

    case 'products':
      return {
        ...state,
        blocks: [...state.blocks, { kind: 'products', id: nextId(), items: e.items, note: e.note }],
      };

    case 'cart': {
      // One cart card per turn.
      //
      // The agent renders the basket twice on purpose — once when it is built,
      // once when the handoff link exists — and appending both left two cards
      // on screen, the first without the link and the second with it. Reading
      // that, the basket looks like it was ordered twice.
      //
      // Scoped to the current turn rather than the whole transcript: a cart
      // shown three messages ago is a record of what the basket was then, and
      // rewriting it would edit history the user has already scrolled past.
      const turnStart = lastIndexWhere(state.blocks, (b) => b.kind === 'user');
      const existing = lastIndexWhere(
        state.blocks,
        (b, i) => i > turnStart && b.kind === 'cart' && b.cart.cartId === e.cart.cartId,
      );
      const prior = existing === -1 ? undefined : (state.blocks[existing] as Extract<Block, { kind: 'cart' }>);

      const block = (id: string): Block => ({
        kind: 'cart',
        id,
        cart: e.cart,
        // Never take the link back off a card that already had one. The render
        // that adds it is the second of the pair, so this only matters in the
        // other order, where dropping it would remove a button the user saw.
        handoffUrl: e.handoffUrl ?? prior?.handoffUrl,
        // The flag is read every hop. A later card without it is the flag off.
        ...(e.dualCheckout ? { dualCheckout: true } : {}),
        ...(e.soloDia ? { soloDia: true } : {}),
        ...(e.orderable === false ? { orderable: false } : {}),
      });

      const blocks = prior
        ? state.blocks.map((b, i) => (i === existing ? block(prior.id) : b))
        : [...state.blocks, block(nextId())];

      return {
        ...state,
        cart: {
          cart: e.cart,
          handoffUrl: e.handoffUrl ?? prior?.handoffUrl,
          ...(e.dualCheckout ? { dualCheckout: true } : {}),
          ...(e.soloDia ? { soloDia: true } : {}),
        },
        // Reusing the id matters: React keys off it, so the card updates in
        // place instead of unmounting and animating back in. The cart-link
        // row is removed in the same step, so it does not sit under the card
        // it was waiting to draw.
        blocks: withoutCartLinkTrail(blocks, turnStart),
      };
    }

    case 'compare': {
      // Same rule as the cart card: one compare block per cart in this turn,
      // replaced in place so the pending row becomes the finished one without
      // a second animation. A compare from an earlier turn stays as history.
      const turnStart = lastIndexWhere(state.blocks, (b) => b.kind === 'user');
      const existing = lastIndexWhere(
        state.blocks,
        (b, i) => i > turnStart && b.kind === 'compare' && b.cartId === e.cartId,
      );
      const prior = existing === -1 ? undefined : (state.blocks[existing] as Extract<Block, { kind: 'compare' }>);
      const block: Extract<Block, { kind: 'compare' }> = e.status === 'pending'
        ? {
            kind: 'compare',
            id: prior?.id ?? nextId(),
            status: 'pending',
            cartId: e.cartId,
            handoffUrl: e.handoffUrl || prior?.handoffUrl || '',
            matched: 0,
            lines: 0,
            rows: [],
          }
        : {
            kind: 'compare',
            id: prior?.id ?? nextId(),
            status: e.status,
            cartId: e.cartId,
            handoffUrl: e.handoffUrl || prior?.handoffUrl || '',
            matched: e.matched,
            lines: e.lines,
            rows: e.rows,
            ...(e.gap ? { gap: e.gap } : {}),
            ...(e.checkoutDemo && (e.status === 'ok' || e.status === 'degraded') && e.matched >= 1
              ? { checkoutDemo: true }
              : {}),
          };
      const blocks = prior
        ? state.blocks.map((b, i) => (i === existing ? block : b))
        : [...state.blocks, block];
      return { ...state, blocks };
    }

    case 'search_compare': {
      // Same rule as the cart card: pending becomes the finished card in place.
      const turnStart = lastIndexWhere(state.blocks, (b) => b.kind === 'user');
      const existing = lastIndexWhere(
        state.blocks,
        (b, i) => i > turnStart && b.kind === 'search_compare' && b.compareId === e.id,
      );
      const prior = existing === -1 ? undefined : (state.blocks[existing] as Extract<Block, { kind: 'search_compare' }>);
      const block: Extract<Block, { kind: 'search_compare' }> = e.status === 'pending'
        ? {
            kind: 'search_compare',
            id: prior?.id ?? nextId(),
            compareId: e.id,
            status: 'pending',
            query: e.query,
            ...(e.postalCode ? { postalCode: e.postalCode } : {}),
            dia: [],
            coto: [],
            ...(e.chains ? { chains: e.chains } : {}),
          }
        : {
            kind: 'search_compare',
            id: prior?.id ?? nextId(),
            compareId: e.id,
            status: e.status,
            query: e.query,
            ...(e.postalCode || prior?.postalCode ? { postalCode: e.postalCode ?? prior?.postalCode } : {}),
            dia: e.dia,
            coto: e.coto,
            ...(e.gapCentavos === undefined ? {} : { gapCentavos: e.gapCentavos }),
            ...(e.feeCentavos === undefined ? {} : { feeCentavos: e.feeCentavos }),
            ...(e.chains ? { chains: e.chains } : {}),
            ...(e.kind ? { typeLabel: e.kind } : {}),
            ...(e.noPair ? { noPair: e.noPair } : {}),
          };
      const blocks = prior
        ? state.blocks.map((b, i) => (i === existing ? block : b))
        : [...state.blocks, block];
      return { ...state, blocks };
    }

    case 'missing':
      return {
        ...state,
        blocks: [
          ...state.blocks,
          { kind: 'missing', id: nextId(), query: e.query, retailer: e.retailer, item: e.item },
        ],
      };

    case 'error': {
      const blocks: Block[] = [
        ...state.blocks,
        { kind: 'error', id: nextId(), message: e.message, recoverable: e.recoverable },
      ];
      // An unrecoverable error ends the turn; nothing further is coming.
      return e.recoverable ? { ...state, blocks } : { ...settled(state), streaming: false, blocks };
    }

    case 'done':
      return { ...settled(state), streaming: false, snapshot: e.snapshot };
  }
}

/** A dropped connection is not a `done`, so the composer has to be freed by hand. */
export function endTurn(state: ChatState, message?: string): ChatState {
  if (!state.streaming) return state;
  const blocks = message
    ? [...state.blocks, { kind: 'error' as const, id: nextId(), message, recoverable: true }]
    : state.blocks;
  return { ...settled(state), streaming: false, blocks };
}

/**
 * Drop error bubbles whose text is exactly `message`.
 * Same reference when nothing matches, so a no-op clear does not re-render.
 */
export function omitErrorMessage(state: ChatState, message: string): ChatState {
  let changed = false;
  const blocks = state.blocks.filter((b) => {
    if (b.kind === 'error' && b.message === message) {
      changed = true;
      return false;
    }
    return true;
  });
  return changed ? { ...state, blocks } : state;
}

/**
 * End a turn that failed, telling the truth about how far it got.
 *
 * "Did the server receive this?" has an exact structural answer already in the
 * transcript: if the last block is still the user's own bubble, nothing came
 * back, so nothing was received — /api/chat writes history only after a clean
 * return. Mark that bubble and the screen stops claiming a message landed when
 * it did not, which is the bug in CLAUDE.md §4 seen from the client side.
 *
 * Once anything has rendered the answer is different. The user is reading half
 * a reply, the server has the message, and "no se envió" would be a visible
 * lie — so that case keeps the error block it has always had.
 *
 * In between is a turn the server acknowledged (`received`) that died before
 * saying anything. The bubble still gets the retry control, since nothing was
 * written, but as `dropped`: the message did arrive.
 */
export function failTurn(state: ChatState, failure: SendFailure): ChatState {
  if (!state.streaming) return state;
  const last = state.blocks.at(-1);
  if (last?.kind !== 'user' || last.failed) return endTurn(state, failure.message);
  const reason = failure.reason === 'network' && state.progress ? 'dropped' : failure.reason;
  return {
    ...settled(state),
    streaming: false,
    blocks: [...state.blocks.slice(0, -1), { ...last, failed: { ...failure, reason } }],
  };
}

/**
 * Send an undelivered message again.
 *
 * The block is reused, not appended: the text is already on screen, and a
 * second identical bubble would read as having said it twice. Keeping the id
 * keeps the React key, so the bubble changes in place instead of unmounting
 * and animating back in — the same reasoning as the cart dedupe above.
 */
export function retryUser(state: ChatState, id: string): ChatState {
  if (state.streaming) return state;
  const i = lastIndexWhere(state.blocks, (b) => b.kind === 'user' && b.id === id && Boolean(b.failed));
  if (i === -1) return state;
  const b = state.blocks[i] as Extract<Block, { kind: 'user' }>;
  // Rebuilt rather than spread: `failed` has to be absent, not undefined, so
  // a retried block is indistinguishable from one that never failed. The photo
  // stays, or a retry of a picture would go out as words alone.
  const cleared: Block = b.image
    ? { kind: 'user', id: b.id, text: b.text, image: b.image }
    : { kind: 'user', id: b.id, text: b.text };
  return {
    ...settled(state),
    streaming: true,
    blocks: state.blocks.map((x, j) => (j === i ? cleared : x)),
  };
}

/**
 * Only the newest message gets a retry control.
 *
 * A network failure leaves the composer usable, so the user can type something
 * else and move on. Re-sending the older message then would reach the server
 * after the newer one, and the history the agent reasons over would be in a
 * different order than the transcript the user is looking at — §4 again, with
 * the two sides swapped. The mark stays on the old bubble as a record of what
 * happened; the button does not.
 */
export function canRetry(state: ChatState, id: string): boolean {
  if (state.streaming) return false;
  const last = state.blocks.at(-1);
  return last?.kind === 'user' && last.id === id && Boolean(last.failed);
}
