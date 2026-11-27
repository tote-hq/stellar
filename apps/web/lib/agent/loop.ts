import type Anthropic from '@anthropic-ai/sdk';

import { callMcpTool, mcpToolsToAnthropic } from '../mcp/bridge';

export { callMcpTool };
import type { Session } from '../mcp/session';
import { DEFAULT_LANG, inLang, type Lang } from '../lang.ts';
import type { ChatImage } from '../chat-image.ts';
import { chatDualCheckoutDemoEnabled, chatDualCompareEnabled, getRetailerSearch } from '../config.ts';
import type { Product } from '@changuito/mcp/types';

import type { UiEvent } from '../protocol';
import { autoCompare } from './auto-compare';
import { syncRailCart } from './cart-sync';
import { earlyCityAsk, earlyLocationAsk, transcriptHasPostal } from './early-ask';
import { changuitoPrompt, payBanner, stateBanner } from './prompt';
import { classifyTopic, offTopicRefusal } from './topic-guard.ts';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import type { HopResult } from './providers/types';
import { freezeAllowed, freezeCotoReal } from '../checkout/coto-real.ts';
import { beginChainSearch, beginDualSearch, chainChoiceOn, dualCheckoutStamp, searchMode } from './search-compare';
import {
  autoRenderCart,
  cartWriteNeedsChoice,
  emptyCache,
  foreignCartSku,
  RENDER_TOOLS,
  RENDER_TOOL_NAMES,
  rememberStructured,
  runRenderTool,
  shopperNamedRetailer,
  type RenderCache,
} from './render-tools';

/** A basket takes a handful of searches. Past this the model is stuck, not working. */
const MAX_HOPS = 12;

/**
 * The turn's share of `maxDuration = 300` on `/api/chat`, with room left to
 * write the closing events. A turn that runs the route out of time dies
 * without a `done`, and the browser holds no snapshot for the next one.
 */
const TURN_BUDGET_MS = 280_000;

export interface Turn {
  messages: Anthropic.MessageParam[];
  cache: RenderCache;
}

export const newTurnState = (): Turn => ({ messages: [], cache: emptyCache() });

/** The server's compare line, appended to the `get_cart_link` tool result. */
function appendCompareNote(
  content: Anthropic.ToolResultBlockParam['content'],
  note: string,
): Anthropic.ToolResultBlockParam['content'] {
  if (typeof content === 'string') return `${content}\n${note}`;
  if (Array.isArray(content)) return [...content, { type: 'text', text: note }];
  return note;
}

/**
 * The shopper's turn: the photo (when there is one), then what they said,
 * then the session banner.
 *
 * The photo goes first so the model reads it before the instruction, and the
 * banner stays last because that is the block `cacheable` marks. A photo is
 * not a price the model is allowed to invent onto a card — it is evidence of
 * what to search for, and the prompt tells it to name only what it can see.
 */
function shopperTurn(userText: string, banner: string, image?: ChatImage): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [];
  if (image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    });
  }
  content.push({ type: 'text', text: userText }, { type: 'text', text: banner });
  return content;
}

/**
 * The messages, with a cache breakpoint on the newest of them.
 *
 * The system block and the tool schemas carry one already and never move: they
 * are the same for the whole conversation. The messages are not. A basket takes
 * up to twelve hops, each one appending an assistant turn and a block of tool
 * results, and a search result is the largest thing in the request by hop
 * three. Without a breakpoint here every hop re-reads the whole growing
 * conversation at full price and full latency — the same twelve searches, paid
 * for twelve times.
 *
 * So the breakpoint moves. It marks the end of what already existed, which
 * means the next hop's prefix is exactly the block this hop just wrote.
 *
 * Three details are load-bearing:
 *
 * - **A shallow copy, never a mutation of `turn.messages`.** The stored
 *   transcript stays free of request-shaping detail that `turn-store.ts`'s
 *   codec would then have to carry, and last hop's breakpoint does not survive
 *   into this one — four per request is the ceiling, and a twelve-hop turn
 *   would sail past it.
 * - **Only on a `user` message.** Before a hop the last message is the
 *   shopper's text or a block of tool results, both of which take
 *   `cache_control`. The exception is `pause_turn`, which loops with an
 *   assistant message last, and a thinking block cannot be marked.
 * - **Nothing breaks when it does not apply.** A prefix under the minimum
 *   cacheable length is a silent no-op rather than an error, so a first hop
 *   with a short prompt simply pays what it always paid.
 */
function cacheable(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return messages;
  const tail = last.content[last.content.length - 1];
  if (!tail) return messages;
  const marked = { ...tail, cache_control: { type: 'ephemeral' as const } };
  const copy = messages.slice();
  copy[copy.length - 1] = {
    ...last,
    content: [...last.content.slice(0, -1), marked as Anthropic.ContentBlockParam],
  };
  return copy;
}

function textOf(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  return content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
}

/** The assistant message immediately before the shopper's latest turn. */
function assistantBeforeLatestUser(messages: Anthropic.MessageParam[]): string {
  let seenUser = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    if (!seenUser) {
      if (message.role === 'user') seenUser = true;
      continue;
    }
    if (message.role === 'assistant') return textOf(message.content);
  }
  return '';
}

function productsOf(structured: unknown): Product[] {
  if (!structured || typeof structured !== 'object') return [];
  const products = (structured as { products?: Product[] }).products;
  return Array.isArray(products) ? products : [];
}

function skuIdsOf(input: unknown): string[] {
  const items = (input as { items?: Array<{ sku_id?: unknown }> } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => (typeof item?.sku_id === 'string' && item.sku_id ? [item.sku_id] : []));
}

function toolError(id: string, message: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content: message, is_error: true };
}

/**
 * Cart writes the loop refuses before they reach a store. A refusal is an
 * error result, so the model reads it and the basket is unchanged.
 */
function refusedCartCall(
  use: Anthropic.ToolUseBlockParam,
  ctx: {
    dual: boolean;
    order: string | undefined;
    userText: string;
    priorAssistant: string;
    cache: RenderCache;
    owner: string | null;
  },
): Anthropic.ToolResultBlockParam | undefined {
  if (use.name === 'choose_retailer') {
    if (!ctx.dual) {
      return toolError(use.id, 'choose_retailer is off. Día and Coto search is not on for this session.');
    }
    const retailer = (use.input as { retailer?: unknown } | null)?.retailer;
    if (retailer !== 'dia' && retailer !== 'coto') {
      return toolError(use.id, 'choose_retailer needs retailer dia or coto.');
    }
    if (!shopperNamedRetailer(retailer, ctx.userText, ctx.priorAssistant)) {
      return toolError(
        use.id,
        'The shopper has not named that store. Ask them, and do not pick the cheaper chain.',
      );
    }
    if (retailer === 'coto' && !freezeAllowed(ctx.cache.cotoRealDia, ctx.owner)) {
      return toolError(use.id, 'The basket belongs to another account. Nothing was changed.');
    }
    return undefined;
  }
  if (use.name !== 'add_to_cart') return undefined;
  if (cartWriteNeedsChoice(ctx.dual, ctx.order)) {
    return toolError(
      use.id,
      'Ask the shopper to pick Día or Coto before adding to the cart. Call choose_retailer with the store they name. Nothing was added.',
    );
  }
  if (ctx.order !== 'dia' && ctx.order !== 'coto') return undefined;
  const diaIds = new Set(ctx.cache.products.keys());
  const cotoIds = new Set(Object.keys(ctx.cache.coto ?? {}));
  const foreign = skuIdsOf(use.input).filter((id) => foreignCartSku(ctx.order as 'dia' | 'coto', id, diaIds, cotoIds));
  if (!foreign.length) return undefined;
  return toolError(
    use.id,
    `${foreign.join(', ')} is from the other supermarket. A ${ctx.order} order only takes ${ctx.order} ids. Nothing was added.`,
  );
}

/**
 * One user message, start to finish.
 *
 * Written against a streaming API rather than a tool runner because every tool
 * call here has a visible consequence — a spinner, a product grid — and owning
 * the loop means owning where those are emitted.
 *
 * One model answers every hop. It used to be a choice per hop, with a local
 * model taking the ones it could and the hosted one picking up the rest; see
 * CLAUDE.md §5 for what that cost and why it is gone. What the seam leaves
 * behind is worth keeping: the loop still talks to a `Provider` and knows
 * nothing about the API underneath it.
 */
export async function runTurn(
  session: Session,
  turn: Turn,
  userText: string,
  emit: (e: UiEvent) => void,
  /** Which language the browser's footer is set to. The route reads it off the request. */
  lang: Lang = DEFAULT_LANG,
  /** A photo of a list, a product or a shelf. Absent when they only typed or spoke. */
  image?: ChatImage,
  /** Signed-in address, or null for a guest. The chat route already computed it. */
  owner: string | null = null,
): Promise<{ brain: string }> {
  const t0 = Date.now();

  // Before the banner and before the model. An empty cache on an isolate that
  // did not run the last turn still has the basket on the session snapshot.
  // view_cart is awaited here, with no trail row and no card for that basket.
  const snap = session.state.snapshot();
  const cotoLines = session.state.cotoLines().length;
  if (!turn.cache.cart && (cotoLines > 0 || snap.carts.dia)) {
    emit({ t: 'status', stage: 'thinking', hop: 0 });
  }
  const synced = await syncRailCart({
    cache: turn.cache,
    cotoLines,
    diaCartId: snap.carts.dia,
    viewCart: async () => {
      const call = await callMcpTool(session.client, { id: 'rail-view', name: 'view_cart', input: {} });
      return { ok: call.block.is_error !== true, structured: call.structured };
    },
  });
  const cartUnknown = synced === 'unknown';

  // Before early-ask and before the model. An off-topic message is not a
  // basket, so it must not become the postal-code question and it must not
  // open a tool. Ambiguous grocery talk falls through; see topic-guard.ts.
  const search = await getRetailerSearch();
  const sessionBanner = (unknown: boolean) => {
    const location = session.state.getLocation();
    const cart = turn.cache.cart;
    const order = session.state.getOrder();
    return stateBanner({
      retailer: location?.retailer,
      postalCode: location?.postalCode ?? session.state.getPendingPostal(),
      city: session.state.getCity(),
      cartLines: cart?.lines.length,
      cartTotal: cart?.total.display,
      searchOrder: search.order,
      order,
      cartUnknown: unknown,
      pay: payBanner({
        order,
        retailer: cart?.retailer,
        cotoPay: turn.cache.cotoPay,
        dualCheckout: turn.cache.dualCheckout,
        lines: cart?.lines,
        totalCentavos: cart?.total.centavos,
      }),
    });
  };
  if (classifyTopic(userText, { hasImage: Boolean(image) }) === 'refuse') {
    const reply = offTopicRefusal(lang, userText);
    turn.messages.push(
      {
        role: 'user',
        content: shopperTurn(userText, sessionBanner(cartUnknown), image),
      },
      { role: 'assistant', content: [{ type: 'text', text: reply }] },
    );
    emit({ t: 'text', delta: reply });
    return { brain: 'topic-guard' };
  }

  // Before the model: see early-ask.ts.
  const ask = earlyLocationAsk({
    hasLocation: Boolean(session.state.getLocation()),
    firstMessage: turn.messages.length === 0,
    text: userText,
    lang,
  });
  if (ask) {
    turn.messages.push(
      { role: 'user', content: shopperTurn(userText, stateBanner({}), image) },
      { role: 'assistant', content: [{ type: 'text', text: ask }] },
    );
    emit({ t: 'text', delta: ask });
    return { brain: 'early-ask' };
  }

  const cityAsk = earlyCityAsk({
    hasLocation: Boolean(session.state.getLocation()),
    hasCity: Boolean(session.state.getCity()),
    knownPostal:
      Boolean(session.state.getPendingPostal()) || transcriptHasPostal(turn.messages, userText),
  });
  if (cityAsk) {
    session.state.markCityAsked();
    turn.messages.push(
      { role: 'user', content: shopperTurn(userText, stateBanner({}), image) },
      { role: 'assistant', content: [{ type: 'text', text: cityAsk }] },
    );
    emit({ t: 'text', delta: cityAsk });
    return { brain: 'early-ask' };
  }

  const brain = process.env.OPENAI_API_KEY?.trim() ? openaiProvider() : anthropicProvider();

  const mcpTools = await mcpToolsToAnthropic(session.client);
  const tools = [...mcpTools, ...RENDER_TOOLS];

  turn.messages.push({
    role: 'user',
    content: shopperTurn(userText, sessionBanner(cartUnknown), image),
  });
  const priorAssistant = assistantBeforeLatestUser(turn.messages);

  // The server's own instructions, then ours. Cached: both are stable for the
  // whole conversation, and they sit ahead of the messages that are not.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `${session.client.getInstructions() ?? ''}\n\n${changuitoPrompt(lang)}`.trim(),
      cache_control: { type: 'ephemeral' },
    },
  ];

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const remaining = TURN_BUDGET_MS - (Date.now() - t0);
    if (remaining <= 0) {
      emit({
        t: 'error',
        message: inLang(lang, {
          es: 'La búsqueda tardó demasiado. Probá pidiéndolo más simple.',
          en: 'The search took too long. Try asking for something simpler.',
        }),
        recoverable: true,
      });
      return { brain: brain.label };
    }

    const cb = {
      onText: (delta: string) => emit({ t: 'text', delta }),
      // Reasoning stays off the thread. The status event still names the hop.
      // The thinking event stays in the protocol so an old bundle still parses.
      onThinking: () => undefined,
    };

    emit({ t: 'status', stage: 'thinking', hop });

    const retailers = await getRetailerSearch();
    const compareOn = await chatDualCompareEnabled();
    const demoOn = await chatDualCheckoutDemoEnabled();
    const choiceNow = () =>
      chainChoiceOn({
        compareOn,
        cotoEnabled: retailers.enabled.coto === true,
        retailer: session.state.getLocation()?.retailer,
      });
    const hopTools = choiceNow() ? tools : tools.filter((tool) => tool.name !== 'choose_retailer');

    // Whatever this throws is the end of the turn: there is nothing left to
    // fall back to, and the route turns it into one message.
    const msg: HopResult = await brain.hop(
      { system, tools: hopTools, messages: cacheable(turn.messages), budgetMs: remaining },
      cb,
    );

    turn.messages.push({ role: 'assistant', content: msg.content });

    if (msg.stopReason === 'refusal') {
      emit({ t: 'error', message: 'No puedo responder eso.', recoverable: false });
      return { brain: brain.label };
    }

    const uses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use',
    );

    if (msg.stopReason === 'max_tokens') {
      // A tool input truncated mid-object can still parse. Running it would be
      // acting on half an instruction.
      emit({
        t: 'error',
        message: inLang(lang, {
          es: 'La respuesta se cortó. Probá de nuevo.',
          en: 'The reply cut out. Try again.',
        }),
        recoverable: true,
      });
      return { brain: brain.label };
    }
    if (msg.stopReason === 'pause_turn') continue;
    if (!uses.length) return { brain: brain.label }; // end_turn, or a reply with nothing to do

    // Every result goes back in one user message. Splitting them across
    // messages teaches the model not to call tools in parallel.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      // The trail is for work, not for drawing. An MCP call reaches a
      // supermarket and can take twenty seconds, so naming it explains the
      // wait and a ✗ explains a gap in the answer. A render tool only moves
      // data the user is already looking at: "mostrando el carrito ✓" sits
      // above the cart it is describing, and a ✗ reports a failure whose only
      // consequence is that the model tries again half a second later.
      const order = session.state.getOrder();
      const mode = searchMode({
        compareOn,
        cotoEnabled: retailers.enabled.coto === true,
        retailer: session.state.getLocation()?.retailer,
        order,
      });
      // A Coto-only search is in-process. It does not call Día and gets no trail row.
      const onlyCoto = use.name === 'search_products' && mode === 'coto';
      const traced = !RENDER_TOOL_NAMES.has(use.name) && !onlyCoto;
      if (traced) emit({ t: 'tool_start', id: use.id, name: use.name });
      const t = Date.now();
      const dual = mode !== 'off';
      const query = typeof (use.input as { query?: unknown } | null)?.query === 'string'
        ? (use.input as { query: string }).query
        : '';
      const postalCode = session.state.getLocation()?.postalCode;

      let result: Anthropic.ToolResultBlockParam;
      const refused = refusedCartCall(use, {
        dual,
        order,
        userText,
        priorAssistant,
        cache: turn.cache,
        owner,
      });
      if (refused) {
        result = refused;
      } else if (RENDER_TOOL_NAMES.has(use.name)) {
        result = runRenderTool(turn.cache, use, emit);
      } else if (onlyCoto) {
        const note = await beginChainSearch({
          chain: 'coto',
          id: use.id,
          query,
          postalCode,
          cache: turn.cache,
          emit,
          cotoLineIds: session.state.cotoLines().map((line) => line.id),
        }).finish();
        result = { type: 'tool_result', tool_use_id: use.id, content: note };
      } else {
        const searchDia = async (term: string) => {
          const wider = await callMcpTool(session.client, {
            id: `${use.id}:wider`,
            name: 'search_products',
            input: { query: term },
          });
          rememberStructured(turn.cache, wider.structured);
          return { products: productsOf(wider.structured), failed: wider.block.is_error === true };
        };
        const cotoLineIds = session.state.cotoLines().map((line) => line.id);
      const chainSearch =
          use.name === 'search_products' && mode === 'dia'
            ? beginChainSearch({
                chain: 'dia',
                id: use.id,
                query,
                postalCode,
                cache: turn.cache,
                emit,
                searchDia,
                cotoLineIds,
              })
            : use.name === 'search_products' && mode === 'both'
              ? beginDualSearch({
                  id: use.id,
                  query,
                  postalCode,
                  cache: turn.cache,
                  emit,
                  searchDia,
                  cotoLineIds,
                })
              : undefined;
        const call = await callMcpTool(session.client, use);
        rememberStructured(turn.cache, call.structured);
        result = call.block;
        if (chainSearch) {
          const note = await chainSearch.finish({
            products: productsOf(call.structured),
            failed: call.block.is_error === true,
          });
          result = { ...result, content: appendCompareNote(result.content, note) };
        }
      }

      if (
        use.name === 'choose_retailer' &&
        result.is_error !== true &&
        (use.input as { retailer?: unknown } | null)?.retailer === 'coto'
      ) {
        const frozen = freezeCotoReal(turn.cache.cotoRealDia, turn.cache.diaPairs ?? [], owner);
        if (frozen.ok) turn.cache.cotoRealDia = frozen.snapshot;
      }

      if (traced) emit({ t: 'tool_end', id: use.id, ok: result.is_error !== true, ms: Date.now() - t });

      // After the tool, so a choose_retailer in this hop clears the stamp
      // before the next card. Solo Día keeps the demo fee path with Coto off.
      turn.cache.dualCheckout = dualCheckoutStamp({
        demoOn,
        cotoEnabled: retailers.enabled.coto === true,
        order: session.state.getOrder(),
      });
      turn.cache.soloDia = demoOn && !retailers.enabled.coto;

      // After the trail row closes, so the card lands under a finished line
      // rather than beside a spinner. The basket is the one thing on screen
      // that is not a recommendation — there is exactly one and the user
      // built it — so a change to it draws itself instead of waiting for the
      // model to call render_cart. See autoRenderCart in render-tools.ts.
      autoRenderCart(turn.cache, emit);

      if (use.name === 'get_cart_link') {
        const note = await autoCompare({
          cache: turn.cache,
          toolName: use.name,
          enabled: compareOn && retailers.enabled.coto,
          postalCode: session.state.getLocation()?.postalCode,
          emit,
        });
        if (note) result = { ...result, content: appendCompareNote(result.content, note) };
      }

      results.push(result);
    }

    turn.messages.push({ role: 'user', content: results });
  }

  emit({
    t: 'error',
    message: inLang(lang, {
      es: 'Me quedé dando vueltas sin llegar a un carrito. Probá pidiéndolo más simple.',
      en: 'I went round in circles without getting to a trolley. Try asking for something simpler.',
    }),
    recoverable: true,
  });
  return { brain: brain.label };
}
