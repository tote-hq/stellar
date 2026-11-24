/**
 * Live reads behind /stats. Runs on the server only.
 *
 * On-chain numbers come from public endpoints and need no secret: Solana
 * devnet JSON-RPC for the escrow program, Stellar Expert for Soroban contract
 * events, Horizon for Stellar transactions. Product numbers come from
 * Postgres (`STATS_STELLAR_DATABASE_URL`, `STATS_SOLANA_DATABASE_URL`):
 * app accounts and delivered orders. The waitlist figure stays on the
 * last published value. When a source is missing or fails, that part
 * keeps its published value and the snapshot says the source is unavailable.
 * Nothing here throws out of loadLiveSnapshot.
 *
 * The whole read shares one deadline. A source that is still pending when
 * the deadline fires is marked unavailable and the published number stays.
 * Every outbound fetch receives that signal, so a hung socket is aborted
 * rather than held until the Worker is killed.
 *
 * The result holds aggregates and public transaction hashes only. Address
 * sets are counted and dropped; they never leave this module.
 */

import {
  FALLBACK_SNAPSHOT,
  SOLANA_PROGRAM_ID,
  STELLAR_CONTRACT_ID,
  STELLAR_DEMO_WALLET,
  STELLAR_RESOLVER,
  STELLAR_TREASURY,
  STELLAR_USDC_ID,
  type Point,
  type StatsSnapshot,
  type Totals,
  type TxRef,
} from './metrics.ts';

export const SOLANA_RPC = 'https://api.devnet.solana.com';
export const STELLAR_EXPERT_API = 'https://api.stellar.expert/explorer/testnet';
export const HORIZON = 'https://horizon-testnet.stellar.org';
export const GITHUB_SEARCH = 'https://api.github.com/search/issues';

/**
 * Bound for one snapshot, including Postgres. Five and a half seconds leaves
 * a little room under a six second page budget after the cache probe.
 */
export const SNAPSHOT_DEADLINE_MS = 5_500;
/** Per-request fetch cap. Combined with the snapshot signal via AbortSignal.any. */
export const FETCH_TIMEOUT_MS = 4_000;
/** One signature page on the request path. Full history is not scanned per hit. */
export const SOLANA_SIG_PAGES = 1;
export const SOLANA_SIG_LIMIT = 80;
/**
 * Transaction bodies fetched per request. The signature list still supplies
 * the transaction count; instruction totals cover this many bodies only.
 */
export const SOLANA_TX_CAP = 16;
const SOLANA_CONCURRENCY = 4;
/** One retry, then stop. An abort is not retried. */
export const SOLANA_RETRIES = 1;
const EXPERT_PAGES = 2;
const HORIZON_PAGES = 2;
const OP_LOOKUP_CAP = 8;
const RECENT_PER_CHAIN = 4;
const DAY_MS = 86_400_000;
/** Stellar testnet contracts went live this day; older history on reused accounts is not Changuito's. */
export const STELLAR_LIVE_SINCE = '2026-09-21T00:00:00Z';

export type QueryFn = (url: string, text: string, signal?: AbortSignal) => Promise<number | null>;

export interface LiveDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** Runs one read-only count query. Injected so tests never touch a database. */
  count?: QueryFn;
  /** Cancels the read. loadLiveSnapshot sets this to the deadline signal. */
  signal?: AbortSignal;
  /** Test override. Production uses SNAPSHOT_DEADLINE_MS. */
  deadlineMs?: number;
}

// ------------------------------------------------------------- helpers --

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'unknown';
  return raw.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 80);
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

/** Rejects when `signal` aborts. The inner promise is left running. */
export function raceSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function requestSignal(deps: LiveDeps, extra?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const parts = [timeout, deps.signal, extra ?? undefined].filter((part): part is AbortSignal => Boolean(part));
  return parts.length === 1 ? (parts[0] as AbortSignal) : AbortSignal.any(parts);
}

async function getJson(deps: LiveDeps, url: string, init?: RequestInit): Promise<unknown> {
  const signal = requestSignal(deps, init?.signal ?? undefined);
  const res = await deps.fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    signal,
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return raceSignal(res.json() as Promise<unknown>, signal);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function bump(map: Map<string, Point>, iso: string, chain: 'solana' | 'stellar'): void {
  const point = map.get(iso) ?? { label: `${iso.slice(5, 7)}/${iso.slice(8, 10)}`, iso, solana: 0, stellar: 0 };
  point[chain] += 1;
  map.set(iso, point);
}

function sorted(map: Map<string, Point>): Point[] {
  return [...map.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (signal?.aborted) return;
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// --------------------------------------------------------------- solana --

export interface ChainRead {
  txs: number;
  /** Day stamps of each successful transaction. */
  txDays: string[];
  /** Day stamps of each escrow opened. */
  cartDays: string[];
  opened: number;
  settled: number;
  refunded: number;
  mintInit: number;
  wallets: Set<string>;
  buyers: Set<string>;
  recent: TxRef[];
  settledUsdc: number;
  /** Bodies whose program logs were read. Zero means instruction totals were not scanned. */
  parsed: number;
}

interface SolSig {
  signature: string;
  err: unknown;
  blockTime: number | null;
}

interface SolTx {
  blockTime?: number | null;
  meta?: {
    logMessages?: string[];
    preTokenBalances?: SolTokenBalance[];
    postTokenBalances?: SolTokenBalance[];
  } | null;
  transaction?: { message?: { accountKeys?: (string | { pubkey: string })[]; header?: { numRequiredSignatures?: number } } };
}

interface SolTokenBalance {
  accountIndex: number;
  uiTokenAmount?: { amount?: string; decimals?: number };
}

async function solanaRpc(deps: LiveDeps, url: string, method: string, params: unknown[]): Promise<unknown> {
  const body = (await getJson(deps, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error('rpc error');
  return body.result;
}

/** Instructions our program logged, read by tracking the invoke stack so token-program logs are not counted. */
export function programInstructions(logs: readonly string[], programId: string): string[] {
  const stack: string[] = [];
  const found: string[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1] as string);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    const ix = /^Program log: Instruction: (\w+)$/.exec(line);
    if (ix && stack[stack.length - 1] === programId) found.push(ix[1] as string);
  }
  return found;
}

function tokenGain(meta: NonNullable<SolTx['meta']>): number {
  const pre = new Map<number, number>();
  for (const b of meta.preTokenBalances ?? []) pre.set(b.accountIndex, Number(b.uiTokenAmount?.amount ?? 0));
  let gain = 0;
  let decimals = 6;
  for (const b of meta.postTokenBalances ?? []) {
    const delta = Number(b.uiTokenAmount?.amount ?? 0) - (pre.get(b.accountIndex) ?? 0);
    if (delta > 0) gain += delta;
    decimals = b.uiTokenAmount?.decimals ?? decimals;
  }
  return gain / 10 ** decimals;
}

export async function readSolana(deps: LiveDeps): Promise<ChainRead> {
  const url = deps.env.STATS_SOLANA_RPC_URL?.trim() || SOLANA_RPC;
  const sigs: SolSig[] = [];
  let before: string | undefined;
  try {
    for (let page = 0; page < SOLANA_SIG_PAGES; page++) {
      if (deps.signal?.aborted) break;
      const opts: Record<string, unknown> = { limit: SOLANA_SIG_LIMIT };
      if (before) opts.before = before;
      const batch = (await solanaRpc(deps, url, 'getSignaturesForAddress', [SOLANA_PROGRAM_ID, opts])) as SolSig[];
      if (!Array.isArray(batch)) throw new Error('bad signatures');
      sigs.push(...batch);
      if (batch.length < SOLANA_SIG_LIMIT) break;
      before = batch[batch.length - 1]?.signature;
    }
  } catch (error) {
    if (sigs.length === 0) throw error;
  }
  if (sigs.length === 0) {
    // A finished call with no rows is zero. An abort with nothing is an outage.
    if (deps.signal?.aborted) throw new Error('solana aborted');
    return {
      txs: 0,
      txDays: [],
      cartDays: [],
      opened: 0,
      settled: 0,
      refunded: 0,
      mintInit: 0,
      wallets: new Set(),
      buyers: new Set(),
      recent: [],
      settledUsdc: 0,
      parsed: 0,
    };
  }
  const ok = sigs.filter((s) => s.err === null || s.err === undefined);
  const read: ChainRead = {
    txs: ok.length,
    txDays: ok.filter((s) => s.blockTime).map((s) => isoDay((s.blockTime as number) * 1000)),
    cartDays: [],
    opened: 0,
    settled: 0,
    refunded: 0,
    mintInit: 0,
    wallets: new Set(),
    buyers: new Set(),
    recent: ok.slice(0, RECENT_PER_CHAIN).map((s) => ({ network: 'solana', hash: s.signature })),
    settledUsdc: 0,
    parsed: 0,
  };
  let details: (SolTx | null)[] = [];
  try {
    // No extra race here: mapLimit stops taking work when the signal aborts,
    // and each fetch carries that signal, so the bodies already in hand are kept.
    details = await mapLimit(
      ok.slice(0, SOLANA_TX_CAP),
      SOLANA_CONCURRENCY,
      async (s) => {
        if (deps.signal?.aborted) return null;
        // One retry for a rate limit. An abort stops the loop; the backoff does not outlive the signal.
        for (let attempt = 0; attempt <= SOLANA_RETRIES; attempt++) {
          if (deps.signal?.aborted) return null;
          try {
            return (await solanaRpc(deps, url, 'getTransaction', [
              s.signature,
              { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
            ])) as SolTx | null;
          } catch {
            if (deps.signal?.aborted || attempt >= SOLANA_RETRIES) return null;
            await delay(200, deps.signal);
          }
        }
        return null;
      },
      deps.signal,
    );
  } catch {
    details = [];
  }
  details.forEach((tx, index) => {
    if (!tx?.meta) return;
    read.parsed += 1;
    const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === 'string' ? k : k.pubkey));
    const signers = keys.slice(0, tx.transaction?.message?.header?.numRequiredSignatures ?? 1);
    for (const signer of signers) read.wallets.add(signer);
    const stamp = tx.blockTime ?? ok[index]?.blockTime;
    for (const ix of programInstructions(tx.meta.logMessages ?? [], SOLANA_PROGRAM_ID)) {
      if (ix === 'Open' || ix === 'OpenServiceFee') {
        read.opened += 1;
        if (stamp) read.cartDays.push(isoDay(stamp * 1000));
        for (const signer of signers) read.buyers.add(signer);
      } else if (ix === 'Settle') {
        read.settled += 1;
        read.settledUsdc += tokenGain(tx.meta);
      } else if (ix === 'Refund') {
        read.refunded += 1;
      } else if (ix.startsWith('Initialize') || ix.startsWith('Init')) {
        read.mintInit += 1;
      }
    }
  });
  return read;
}

// -------------------------------------------------------------- stellar --

interface ExpertEvent {
  id: string;
  ts: number;
  initiator?: string;
  topics?: string[];
}

async function expertEvents(deps: LiveDeps, contract: string): Promise<ExpertEvent[]> {
  const all: ExpertEvent[] = [];
  let cursor = '';
  for (let page = 0; page < EXPERT_PAGES; page++) {
    if (deps.signal?.aborted) break;
    const q = `order=asc&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    let body: { _embedded?: { records?: (ExpertEvent & { paging_token?: string })[] } };
    try {
      body = (await getJson(deps, `${STELLAR_EXPERT_API}/contract/${contract}/events?${q}`)) as typeof body;
    } catch (error) {
      if (all.length > 0) break;
      throw error;
    }
    const records = body._embedded?.records ?? [];
    all.push(...records);
    if (records.length < 200) break;
    cursor = records[records.length - 1]?.paging_token ?? records[records.length - 1]?.id ?? '';
    if (!cursor) break;
  }
  if (deps.signal?.aborted && all.length === 0) throw new Error('stellar events aborted');
  return all;
}

interface HorizonTx {
  hash: string;
  created_at: string;
  successful?: boolean;
  paging_token?: string;
}

async function horizonTxs(deps: LiveDeps, account: string): Promise<HorizonTx[]> {
  const all: HorizonTx[] = [];
  let cursor = '';
  for (let page = 0; page < HORIZON_PAGES; page++) {
    if (deps.signal?.aborted) break;
    const q = `order=desc&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    let body: { _embedded?: { records?: HorizonTx[] } };
    try {
      body = (await getJson(deps, `${HORIZON}/accounts/${account}/transactions?${q}`)) as typeof body;
    } catch (error) {
      // An unfunded account has no history; that is zero, not an outage.
      if (error instanceof Error && error.message === 'upstream 404') return all;
      if (all.length > 0) break;
      throw error;
    }
    const records = body._embedded?.records ?? [];
    all.push(...records.filter((tx) => tx.created_at >= STELLAR_LIVE_SINCE));
    if (records.length < 200) break;
    if ((records[records.length - 1]?.created_at ?? '') < STELLAR_LIVE_SINCE) break;
    cursor = records[records.length - 1]?.paging_token ?? '';
    if (!cursor) break;
  }
  if (deps.signal?.aborted && all.length === 0) throw new Error('horizon aborted');
  return all;
}

const G_ADDRESS = /^G[A-Z2-7]{55}$/;

export async function readStellar(deps: LiveDeps): Promise<ChainRead> {
  const tracked = [STELLAR_RESOLVER, STELLAR_TREASURY, STELLAR_DEMO_WALLET];
  const deposit = deps.env.STATS_STELLAR_DEPOSIT_ADDRESS?.trim();
  if (deposit && G_ADDRESS.test(deposit)) tracked.push(deposit);

  const [escrow, usdc, ...histories] = await Promise.all([
    expertEvents(deps, STELLAR_CONTRACT_ID).catch(() => null),
    expertEvents(deps, STELLAR_USDC_ID).catch(() => null),
    ...tracked.map((account) => horizonTxs(deps, account).catch(() => null)),
  ]);
  if (escrow === null && usdc === null && histories.every((list) => list === null)) {
    throw new Error('stellar unavailable');
  }

  const txs = new Map<string, string>();
  for (const list of histories) {
    for (const tx of list ?? []) if (tx.successful !== false) txs.set(tx.hash, tx.created_at);
  }

  const read: ChainRead = {
    txs: 0,
    txDays: [],
    cartDays: [],
    opened: 0,
    settled: 0,
    refunded: 0,
    mintInit: 0,
    wallets: new Set(),
    buyers: new Set(),
    recent: [],
    settledUsdc: 0,
    parsed: 0,
  };

  const outside: string[] = [];
  for (const event of [...(escrow ?? []), ...(usdc ?? [])]) {
    const [kind, ...rest] = event.topics ?? [];
    for (const value of [event.initiator, ...rest]) if (value && G_ADDRESS.test(value)) read.wallets.add(value);
    if (event.initiator && !tracked.includes(event.initiator)) outside.push(event.id);
    if (kind === 'opened') {
      read.opened += 1;
      read.cartDays.push(isoDay(event.ts * 1000));
      const buyer = rest.find((value) => G_ADDRESS.test(value));
      if (buyer) read.buyers.add(buyer);
    } else if (kind === 'settled') read.settled += 1;
    else if (kind === 'refunded') read.refunded += 1;
    else if (kind === 'mint') read.mintInit += 1;
  }

  // Contract calls signed by a shopper's own wallet are not in the tracked
  // accounts' history. Their operation id leads to the transaction.
  const ops = [...new Set(outside.map((id) => id.split('-')[0]?.replace(/^0+/, '') ?? ''))].filter(Boolean);
  if (!deps.signal?.aborted) {
    try {
      await raceSignal(
        mapLimit(
          ops.slice(0, OP_LOOKUP_CAP),
          4,
          async (op) => {
            if (deps.signal?.aborted) return;
            try {
              const body = (await getJson(deps, `${HORIZON}/operations/${op}`)) as {
                transaction_hash?: string;
                created_at?: string;
                transaction_successful?: boolean;
              };
              if (body.transaction_hash && body.created_at && body.created_at >= STELLAR_LIVE_SINCE && body.transaction_successful !== false) {
                txs.set(body.transaction_hash, body.created_at);
              }
            } catch {
              // One missing lookup undercounts by one; it does not sink the chain.
            }
          },
          deps.signal,
        ),
        deps.signal,
      );
    } catch {
      // The lookups that finished are already on `txs`.
    }
  }

  const ordered = [...txs.entries()].sort((a, b) => b[1].localeCompare(a[1]));
  read.txs = ordered.length;
  read.txDays = ordered.map(([, at]) => at.slice(0, 10));
  read.recent = ordered.slice(0, RECENT_PER_CHAIN).map(([hash]) => ({ network: 'stellar', hash }));
  // Event totals are the instruction scan. Solana uses `parsed` for transaction bodies.
  read.parsed = 1;
  return read;
}

// -------------------------------------------------------------- product --

/** The published waitlist figure. Signups are not counted from the database. */
export async function readWaitlist(_deps: LiveDeps): Promise<number | null> {
  return null;
}

export interface AppDbRead {
  accounts: number;
  delivered: number | null;
}

/** Fixed, parameter-free count queries. Read-only role recommended. */
export const STELLAR_ACCOUNTS_SQL = 'select count(distinct address)::int as n from chat';
export const STELLAR_DELIVERED_SQL = "select count(*)::int as n from orders where status = 'done'";
export const SOLANA_ACCOUNTS_SQL = "select count(*)::int as n from profile where network = 'devnet'";

export async function readAppDb(deps: LiveDeps): Promise<AppDbRead | null> {
  const stellarUrl = deps.env.STATS_STELLAR_DATABASE_URL?.trim();
  const solanaUrl = deps.env.STATS_SOLANA_DATABASE_URL?.trim();
  if (!deps.count || (!stellarUrl && !solanaUrl)) return null;
  const count = deps.count;
  const safe = async (url: string | undefined, sql: string) => {
    if (!url) return null;
    try {
      return await raceSignal(count(url, sql, deps.signal), deps.signal);
    } catch {
      return null;
    }
  };
  const [stellarAccounts, delivered, solanaAccounts] = await Promise.all([
    safe(stellarUrl, STELLAR_ACCOUNTS_SQL),
    safe(stellarUrl, STELLAR_DELIVERED_SQL),
    safe(solanaUrl, SOLANA_ACCOUNTS_SQL),
  ]);
  // Configured, and every count failed or was aborted. Distinct from "no URL".
  if (stellarAccounts === null && solanaAccounts === null) throw new Error('app db unavailable');
  return { accounts: (stellarAccounts ?? 0) + (solanaAccounts ?? 0), delivered };
}

export async function readMergedPrs(deps: LiveDeps): Promise<number | null> {
  const q = encodeURIComponent('is:pr is:merged repo:tote-hq/stellar repo:tote-hq/solana');
  const body = (await getJson(deps, `${GITHUB_SEARCH}?q=${q}&per_page=1`, {
    headers: { 'user-agent': 'changuito-stats', accept: 'application/vnd.github+json' },
  })) as { total_count?: unknown };
  return typeof body.total_count === 'number' ? body.total_count : null;
}

// ------------------------------------------------------------- assembly --

function countSince(days: readonly string[], start: string, end: string): number {
  return days.filter((d) => d >= start && d <= end).length;
}

function dbConfigured(deps: LiveDeps): boolean {
  return Boolean(
    deps.count && (deps.env.STATS_STELLAR_DATABASE_URL?.trim() || deps.env.STATS_SOLANA_DATABASE_URL?.trim()),
  );
}

/** A snapshot worth caching: at least one upstream answered. */
export function isGoodSnapshot(snapshot: StatsSnapshot): boolean {
  const sources = snapshot.sources;
  return (
    sources.solana === 'live' ||
    sources.stellar === 'live' ||
    sources.github === 'live' ||
    sources.appDb === 'live'
  );
}

interface ReadBox {
  sol: ChainRead | null;
  stl: ChainRead | null;
  waitlist: number | null | undefined;
  db: AppDbRead | null | undefined;
  prs: number | null | undefined;
  solFailed: boolean;
  stlFailed: boolean;
  dbFailed: boolean;
  prsFailed: boolean;
}

async function runSource(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[stats] ${label} unavailable:`, safeError(error));
  }
}

export async function loadLiveSnapshot(deps: LiveDeps): Promise<StatsSnapshot> {
  const deadlineMs = deps.deadlineMs ?? SNAPSHOT_DEADLINE_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('stats deadline', 'TimeoutError'));
  }, deadlineMs);
  const parent = deps.signal;
  const onParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', onParent);

  const scoped: LiveDeps = { ...deps, signal: controller.signal };
  const box: ReadBox = {
    sol: null,
    stl: null,
    waitlist: undefined,
    db: undefined,
    prs: undefined,
    solFailed: false,
    stlFailed: false,
    dbFailed: false,
    prsFailed: false,
  };

  const all = Promise.all([
    runSource('solana', async () => {
      try {
        box.sol = await readSolana(scoped);
      } catch (error) {
        box.solFailed = true;
        throw error;
      }
    }),
    runSource('stellar', async () => {
      try {
        box.stl = await readStellar(scoped);
      } catch (error) {
        box.stlFailed = true;
        throw error;
      }
    }),
    runSource('waitlist', async () => {
      box.waitlist = await readWaitlist(scoped);
    }),
    runSource('app-db', async () => {
      try {
        box.db = await readAppDb(scoped);
      } catch (error) {
        box.dbFailed = true;
        throw error;
      }
    }),
    runSource('github', async () => {
      try {
        const prs = await readMergedPrs(scoped);
        if (prs === null) box.prsFailed = true;
        else box.prs = prs;
      } catch (error) {
        box.prsFailed = true;
        throw error;
      }
    }),
  ]);

  try {
    const deadline = new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve();
      else controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    const winner = await Promise.race([all.then(() => 'done' as const), deadline.then(() => 'deadline' as const)]);
    // Sources that honor the signal settle on the next microtasks. Give them
    // a short beat so a partial chain read can land before we assemble.
    if (winner === 'deadline') {
      await Promise.race([all.then(() => undefined, () => undefined), delay(50)]);
    }
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParent);
  }

  if (!box.sol && !box.solFailed) box.solFailed = true;
  if (!box.stl && !box.stlFailed) box.stlFailed = true;
  if (box.db === undefined && dbConfigured(deps)) box.dbFailed = true;
  if (box.prs === undefined) box.prsFailed = true;

  return assembleSnapshot(deps, box);
}

function assembleSnapshot(deps: LiveDeps, box: ReadBox): StatsSnapshot {
  const sol = box.sol;
  const stl = box.stl;
  const waitlist = box.waitlist ?? null;
  const db = box.db ?? null;
  const prs = typeof box.prs === 'number' ? box.prs : null;
  const base = FALLBACK_SNAPSHOT;
  const now = deps.now();
  const asOf = isoDay(now.getTime());
  const start30 = isoDay(now.getTime() - 29 * DAY_MS);
  // Instruction totals need parsed bodies. A signature list alone must not zero the carts.
  const solIx = sol && sol.parsed > 0 ? sol : null;
  const stlIx = stl && stl.parsed > 0 ? stl : null;

  // A chain that failed keeps its published day buckets so the chart does not lie by omission.
  const txMap = new Map<string, Point>();
  const cartMap = new Map<string, Point>();
  const fillPublished = (chain: 'solana' | 'stellar', kind: 'tx' | 'cart', target: Map<string, Point>) => {
    const source = kind === 'tx' ? base.txDay : base.cartDay;
    for (const point of source) {
      for (let i = 0; i < point[chain]; i++) bump(target, point.iso, chain);
    }
  };
  for (const [chain, read, ix] of [
    ['solana', sol, solIx],
    ['stellar', stl, stlIx],
  ] as const) {
    if (read) for (const day of read.txDays) bump(txMap, day, chain);
    else fillPublished(chain, 'tx', txMap);
    if (ix) for (const day of ix.cartDays) bump(cartMap, day, chain);
    else fillPublished(chain, 'cart', cartMap);
  }

  const b = base.totals;
  const infraSol = solIx ? [...solIx.wallets].filter((w) => !solIx.buyers.has(w)).length : null;
  const infraStl = stlIx ? [...stlIx.wallets].filter((w) => !stlIx.buyers.has(w)).length : null;
  const walletsSolana = solIx ? solIx.wallets.size : b.walletsSolana;
  const walletsStellar = stlIx ? stlIx.wallets.size : b.walletsStellar;
  const infra = infraSol !== null && infraStl !== null ? infraSol + infraStl : b.infra;

  const totals: Totals = {
    endUsers: waitlist ?? b.endUsers,
    // The published 30-day delta is pinned to the snapshot day, so a live page never repeats it.
    endUsersDelta30d: null,
    realOrders: db?.delivered ?? b.realOrders,
    txSolana: sol ? sol.txs : b.txSolana,
    txStellar: stl ? stl.txs : b.txStellar,
    txDelta30d:
      (sol ? countSince(sol.txDays, start30, asOf) : 0) + (stl ? countSince(stl.txDays, start30, asOf) : 0),
    cartsSolana: solIx ? solIx.opened : b.cartsSolana,
    cartsStellar: stlIx ? stlIx.opened : b.cartsStellar,
    settled: solIx || stlIx ? (solIx?.settled ?? 0) + (stlIx?.settled ?? 0) : b.settled,
    settledUsdc: solIx ? solIx.settledUsdc.toFixed(2) : b.settledUsdc,
    stellarMints: stlIx ? stlIx.mintInit : b.stellarMints,
    walletsSolana,
    walletsStellar,
    buyers: Math.max(0, walletsSolana + walletsStellar - infra),
    infra,
    escrowOpen: (solIx ? solIx.opened : b.cartsSolana) + (stlIx ? stlIx.opened : b.cartsStellar),
    escrowRefund: (solIx ? solIx.refunded : 0) + (stlIx ? stlIx.refunded : 0),
    tokenMintInit: (solIx ? solIx.mintInit : 0) + (stlIx ? stlIx.mintInit : 0),
    mergedPrs: prs ?? b.mergedPrs,
    appAccounts: db?.accounts ?? null,
  };
  if (!solIx && !stlIx) {
    totals.escrowOpen = b.escrowOpen;
    totals.settled = b.settled;
    totals.escrowRefund = b.escrowRefund;
    totals.tokenMintInit = b.tokenMintInit;
  }
  if (!sol && !stl) totals.txDelta30d = b.txDelta30d;

  const recent: TxRef[] = [
    ...(sol ? sol.recent : base.recentTxs.filter((t) => t.network === 'solana')),
    ...(stl ? stl.recent : base.recentTxs.filter((t) => t.network === 'stellar')),
  ];

  return {
    asOf: sol || stl ? asOf : base.asOf,
    updatedAt: now.toISOString(),
    totals,
    txDay: sorted(txMap),
    cartDay: sorted(cartMap),
    recentTxs: recent,
    sources: {
      solana: sol ? 'live' : 'unavailable',
      stellar: stl ? 'live' : 'unavailable',
      waitlist: waitlist === null ? 'snapshot' : 'live',
      appDb: !dbConfigured(deps) ? 'snapshot' : db ? 'live' : 'unavailable',
      github: prs === null ? 'unavailable' : 'live',
    },
  };
}
