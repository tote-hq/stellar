import type Anthropic from '@anthropic-ai/sdk';
import type { Cart, Product } from '@changuito/mcp/types';

import { decodeCotoRealDia, decodeDiaPairs, type CotoRealDia, type DiaPair } from '../checkout/coto-real.ts';
import { Redis } from '@upstash/redis';

// Type-only, deliberately: a store that imported the agent loop would drag the
// Anthropic client and the whole MCP bridge in behind it, for a file that only
// ever moves plain data.
import type { CompareCard } from '../protocol';
import type { Turn } from './loop';
import type { CotoCacheItem, SearchRecord } from './render-tools';

/**
 * Where a conversation lives between two requests.
 *
 * `lib/mcp/session.ts` states the hard part already: a lambda's module scope is
 * a cache, not a database. MCP state got an answer for that — the browser holds
 * the snapshot and sends it back. Message history never did, and it showed: a
 * cold start mid-basket left the agent replying with no idea what had been
 * asked, while the UI still displayed every bubble. The user sees continuity
 * the server does not have, which is the worst shape a bug can take.
 *
 * History cannot ride along in the snapshot the way a postal code can. The
 * snapshot is public — a cart id is already handed over as a URL — whereas the
 * transcript is the conversation itself, and it grows every hop. So it goes to
 * Redis instead, keyed by session.
 *
 * With no Redis configured — a fresh clone, `npm run dev`, nobody's account —
 * this falls back to the in-process Map it replaces. One developer on one
 * machine has exactly one instance, so the Map is not a compromise there; it is
 * the same guarantee for free.
 */

/**
 * Long enough to finish a shop after a phone call, short enough that abandoned
 * baskets expire themselves. Nothing here is worth keeping overnight: the cart
 * lives at the retailer, and the escrow lives on-chain.
 */
const TTL_SECONDS = 60 * 60;

const KEY = (sessionId: string) => `changuito:turn:${sessionId}`;

// --------------------------------------------------------------- wire format

/**
 * `RenderCache.products` is a Map, and `JSON.stringify` renders a Map as `{}` —
 * silently, with no error to notice. So the shape that goes over the wire is
 * not the shape held in memory, and the conversion is explicit in both
 * directions rather than implied by a spread.
 */
interface StoredTurn {
  v: 1;
  messages: Anthropic.MessageParam[];
  products: [string, Product][];
  cart?: Cart;
  handoffUrl?: string;
  /**
   * Which cart the link opens, and what the last cart card showed. Both are
   * new, and both are optional rather than a `v: 2` — a version bump resets
   * the history of every conversation in flight at deploy time, which is a
   * worse trade than one turn without a link on a card that already had one.
   * See autoRenderCart in render-tools.ts.
   */
  handoffFor?: string;
  drawn?: string;
  /**
   * The Día vs Coto card for this fingerprint. Optional on `v: 1` so a turn
   * stored before the card existed still decodes. See autoCompare.
   */
  compareFor?: string;
  compareResult?: CompareCard;
  /** Coto hits and the searches that produced them. Optional on `v: 1`. */
  coto?: Record<string, CotoCacheItem>;
  searches?: SearchRecord[];
  /** Día pairs and the chain-pick snapshot. Optional arrays, never a Map. */
  diaPairs?: DiaPair[];
  cotoRealDia?: CotoRealDia;
  /** Día sku ids already on a search row. Optional array, never a Map. */
  compared?: string[];
  /** This request's Coto admission. Optional on `v: 1`. */
  cotoPay?: boolean;
}

export function encodeTurn(turn: Turn): StoredTurn {
  return {
    v: 1,
    messages: turn.messages,
    products: [...turn.cache.products],
    cart: turn.cache.cart,
    handoffUrl: turn.cache.handoffUrl,
    handoffFor: turn.cache.handoffFor,
    drawn: turn.cache.drawn,
    compareFor: turn.cache.compareFor,
    compareResult: turn.cache.compareResult,
    ...(turn.cache.coto ? { coto: turn.cache.coto } : {}),
    ...(turn.cache.searches ? { searches: turn.cache.searches } : {}),
    ...(turn.cache.diaPairs ? { diaPairs: turn.cache.diaPairs } : {}),
    ...(turn.cache.cotoRealDia ? { cotoRealDia: turn.cache.cotoRealDia } : {}),
    ...(turn.cache.compared ? { compared: turn.cache.compared } : {}),
    ...(typeof turn.cache.cotoPay === 'boolean' ? { cotoPay: turn.cache.cotoPay } : {}),
  };
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || item.length > 64) continue;
    out.push(item);
  }
  return out.length ? out : undefined;
}

function asCompareCard(value: unknown): CompareCard | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const card = value as Partial<CompareCard>;
  if (card.status !== 'ok' && card.status !== 'degraded' && card.status !== 'timed_out') return undefined;
  if (typeof card.cartId !== 'string' || typeof card.handoffUrl !== 'string') return undefined;
  if (!Number.isSafeInteger(card.matched) || !Number.isSafeInteger(card.lines)) return undefined;
  if (!Array.isArray(card.rows)) return undefined;
  return card as CompareCard;
}

function asCoto(value: unknown): Record<string, CotoCacheItem> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, CotoCacheItem> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<CotoCacheItem>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    if (!Number.isSafeInteger(item.shelfCentavos) || (item.shelfCentavos ?? 0) <= 0) continue;
    out[key] = {
      id: item.id,
      name: item.name,
      shelfCentavos: item.shelfCentavos as number,
      available: item.available === true,
      ...(typeof item.ean === 'string' ? { ean: item.ean } : {}),
      ...(typeof item.brand === 'string' ? { brand: item.brand } : {}),
      ...(typeof item.url === 'string' ? { url: item.url } : {}),
      ...(typeof item.imageUrl === 'string' ? { imageUrl: item.imageUrl } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function asSearches(value: unknown): SearchRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: SearchRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Partial<SearchRecord>;
    if (typeof row.query !== 'string' || (row.retailer !== 'dia' && row.retailer !== 'coto')) continue;
    if (!Number.isSafeInteger(row.available) || (row.available ?? -1) < 0) continue;
    rows.push({ query: row.query, retailer: row.retailer, available: row.available as number });
  }
  return rows.length ? rows : undefined;
}

/**
 * Anything unrecognised decodes to undefined rather than throwing. A stored
 * value can outlive the code that wrote it — a deploy mid-conversation is the
 * ordinary case — and starting a fresh turn is a far better answer there than
 * a 500 on a key the next deploy would have expired anyway.
 */
export function decodeTurn(raw: unknown): Turn | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Partial<StoredTurn>;
  if (s.v !== 1 || !Array.isArray(s.messages) || !Array.isArray(s.products)) return undefined;
  const coto = asCoto(s.coto);
  const searches = asSearches(s.searches);
  const diaPairs = decodeDiaPairs(s.diaPairs);
  const cotoRealDia = decodeCotoRealDia(s.cotoRealDia);
  const compared = asStringArray(s.compared);

  return {
    messages: s.messages,
    cache: {
      products: new Map(s.products),
      cart: s.cart,
      handoffUrl: s.handoffUrl,
      handoffFor: s.handoffFor,
      drawn: s.drawn,
      compareFor: typeof s.compareFor === 'string' ? s.compareFor : undefined,
      compareResult: asCompareCard(s.compareResult),
      ...(coto ? { coto } : {}),
      ...(searches ? { searches } : {}),
      ...(diaPairs ? { diaPairs } : {}),
      ...(cotoRealDia ? { cotoRealDia } : {}),
      ...(compared ? { compared } : {}),
      ...(typeof s.cotoPay === 'boolean' ? { cotoPay: s.cotoPay } : {}),
    },
  };
}

// ------------------------------------------------------------------- backends

export interface TurnStore {
  /** The conversation so far, or undefined to start one. */
  get(sessionId: string): Promise<Turn | undefined>;
  set(sessionId: string, turn: Turn): Promise<void>;
  /** For the banner in the server log, so it is obvious which one is running. */
  readonly kind: 'redis' | 'memory';
}

/**
 * `KV_REST_API_URL` / `KV_REST_API_TOKEN` and `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` are the same REST endpoint, so both pairs are
 * accepted and neither is worth making the reader care about.
 *
 * The REST pair is the one to use, not `REDIS_URL` or `KV_URL`: those are
 * `rediss://` strings for a TCP client, and a TCP connection per isolate is the
 * connection-limit problem that picking an HTTP client avoids.
 */
function credentials(): { url: string; token: string } | undefined {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : undefined;
}

function redisStore(url: string, token: string): TurnStore {
  const redis = new Redis({ url, token });

  return {
    kind: 'redis',

    // A Redis that is down should cost the user their history, not their turn.
    // Both paths swallow and degrade: `get` starts a fresh conversation, `set`
    // leaves the old value to expire. Either is survivable; a 500 is not.
    async get(sessionId) {
      try {
        return decodeTurn(await redis.get(KEY(sessionId)));
      } catch (e) {
        console.error('[turn-store] read failed, starting fresh:', e);
        return undefined;
      }
    },

    async set(sessionId, turn) {
      try {
        await redis.set(KEY(sessionId), encodeTurn(turn), { ex: TTL_SECONDS });
      } catch (e) {
        console.error('[turn-store] write failed, history not saved:', e);
      }
    },
  };
}

/**
 * The single-instance fallback. Bounded, unlike the bare Map it replaces: that
 * one held every session it had ever seen for the life of the process, which a
 * long-running server would eventually notice.
 */
function memoryStore(): TurnStore {
  const turns = new Map<string, { turn: Turn; lastUsed: number }>();
  const MAX = 64;

  return {
    kind: 'memory',

    async get(sessionId) {
      const hit = turns.get(sessionId);
      if (!hit) return undefined;
      if (Date.now() - hit.lastUsed > TTL_SECONDS * 1000) {
        turns.delete(sessionId);
        return undefined;
      }
      hit.lastUsed = Date.now();
      return hit.turn;
    },

    async set(sessionId, turn) {
      turns.set(sessionId, { turn, lastUsed: Date.now() });
      while (turns.size > MAX) {
        const oldest = [...turns.entries()].reduce((a, b) => (a[1].lastUsed <= b[1].lastUsed ? a : b));
        turns.delete(oldest[0]);
      }
    },
  };
}

/**
 * A store aimed at one REST endpoint.
 *
 * `turnStore()` reads the environment once and keeps that answer for the
 * process. A test that starts its own Redis — standing in for Upstash —
 * has to point at that endpoint without changing the one already chosen.
 */
export function turnStoreAt(url: string, token: string): TurnStore {
  return redisStore(url, token);
}

let store: TurnStore | undefined;

export function turnStore(): TurnStore {
  if (!store) {
    const creds = credentials();
    store = creds ? redisStore(creds.url, creds.token) : memoryStore();
    console.log(
      store.kind === 'redis'
        ? '[turn-store] Redis — history survives cold starts.'
        : '[turn-store] in-memory — history is lost when this process restarts. Set KV_REST_API_URL and KV_REST_API_TOKEN to persist it.',
    );
  }
  return store;
}
