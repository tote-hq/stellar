/**
 * Live reads behind /stats. Runs on the server only.
 *
 * On-chain numbers come from public endpoints and need no secret: Solana
 * devnet JSON-RPC for the escrow program, Stellar Expert for Soroban contract
 * events, Horizon for Stellar transactions. Product numbers come from
 * Postgres (`STATS_STELLAR_DATABASE_URL`, `STATS_SOLANA_DATABASE_URL`):
 * app accounts, delivered orders, and the waitlist count in `config`.
 * When a source is missing or fails, that part keeps the last published
 * value and the snapshot says so. Nothing here throws.
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

const TIMEOUT_MS = 8_000;
const SOLANA_SIG_PAGES = 5;
const SOLANA_TX_CAP = 400;
const SOLANA_CONCURRENCY = 3;
const SOLANA_RETRIES = 3;
const EXPERT_PAGES = 10;
const HORIZON_PAGES = 5;
const OP_LOOKUP_CAP = 50;
const RECENT_PER_CHAIN = 4;
const DAY_MS = 86_400_000;
/** Stellar testnet contracts went live this day; older history on reused accounts is not Changuito's. */
export const STELLAR_LIVE_SINCE = '2026-09-21T00:00:00Z';

export type QueryFn = (url: string, text: string) => Promise<number | null>;

export interface LiveDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** Runs one read-only count query. Injected so tests never touch a database. */
  count?: QueryFn;
}

// ------------------------------------------------------------- helpers --

async function getJson(deps: LiveDeps, url: string, init?: RequestInit): Promise<unknown> {
  const res = await deps.fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
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

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
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
  for (let page = 0; page < SOLANA_SIG_PAGES; page++) {
    const opts: Record<string, unknown> = { limit: 1000 };
    if (before) opts.before = before;
    const batch = (await solanaRpc(deps, url, 'getSignaturesForAddress', [SOLANA_PROGRAM_ID, opts])) as SolSig[];
    if (!Array.isArray(batch)) throw new Error('bad signatures');
    sigs.push(...batch);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1]?.signature;
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
  };
  const details = await mapLimit(ok.slice(0, SOLANA_TX_CAP), SOLANA_CONCURRENCY, async (s) => {
    // Public devnet RPC rate-limits bursts; back off and retry before giving up on one transaction.
    for (let attempt = 0; attempt <= SOLANA_RETRIES; attempt++) {
      try {
        return (await solanaRpc(deps, url, 'getTransaction', [
          s.signature,
          { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        ])) as SolTx | null;
      } catch {
        if (attempt < SOLANA_RETRIES) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    return null;
  });
  details.forEach((tx, index) => {
    if (!tx?.meta) return;
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
    const q = `order=asc&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = (await getJson(deps, `${STELLAR_EXPERT_API}/contract/${contract}/events?${q}`)) as {
      _embedded?: { records?: (ExpertEvent & { paging_token?: string })[] };
    };
    const records = body._embedded?.records ?? [];
    all.push(...records);
    if (records.length < 200) break;
    cursor = records[records.length - 1]?.paging_token ?? records[records.length - 1]?.id ?? '';
    if (!cursor) break;
  }
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
    const q = `order=desc&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    let body: { _embedded?: { records?: HorizonTx[] } };
    try {
      body = (await getJson(deps, `${HORIZON}/accounts/${account}/transactions?${q}`)) as typeof body;
    } catch (error) {
      // An unfunded account has no history; that is zero, not an outage.
      if (error instanceof Error && error.message === 'upstream 404') return all;
      throw error;
    }
    const records = body._embedded?.records ?? [];
    all.push(...records.filter((tx) => tx.created_at >= STELLAR_LIVE_SINCE));
    if (records.length < 200) break;
    if ((records[records.length - 1]?.created_at ?? '') < STELLAR_LIVE_SINCE) break;
    cursor = records[records.length - 1]?.paging_token ?? '';
    if (!cursor) break;
  }
  return all;
}

const G_ADDRESS = /^G[A-Z2-7]{55}$/;

export async function readStellar(deps: LiveDeps): Promise<ChainRead> {
  const tracked = [STELLAR_RESOLVER, STELLAR_TREASURY, STELLAR_DEMO_WALLET];
  const deposit = deps.env.STATS_STELLAR_DEPOSIT_ADDRESS?.trim();
  if (deposit && G_ADDRESS.test(deposit)) tracked.push(deposit);

  const [escrow, usdc, ...histories] = await Promise.all([
    expertEvents(deps, STELLAR_CONTRACT_ID),
    expertEvents(deps, STELLAR_USDC_ID),
    ...tracked.map((account) => horizonTxs(deps, account)),
  ]);

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
  };

  const outside: string[] = [];
  for (const event of [...escrow, ...usdc]) {
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
  await mapLimit(ops.slice(0, OP_LOOKUP_CAP), 4, async (op) => {
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
  });

  const ordered = [...txs.entries()].sort((a, b) => b[1].localeCompare(a[1]));
  read.txs = ordered.length;
  read.txDays = ordered.map(([, at]) => at.slice(0, 10));
  read.recent = ordered.slice(0, RECENT_PER_CHAIN).map(([hash]) => ({ network: 'stellar', hash }));
  return read;
}

// -------------------------------------------------------------- product --

/** JSON number in `config`. Missing row, or a non-number, keeps the snapshot. */
export const WAITLIST_CONFIG_KEY = 'waitlist_count';

/**
 * Fixed query. Stellar is tried first, then Solana, so one row is enough.
 * The read-only role needs SELECT on `config.key` and `config.value` for this key.
 */
export const WAITLIST_COUNT_SQL =
  "select trunc((value #>> '{}')::numeric)::int as n from config where key = 'waitlist_count' and jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 0";

export async function readWaitlist(deps: LiveDeps): Promise<number | null> {
  if (!deps.count) return null;
  for (const raw of [deps.env.STATS_STELLAR_DATABASE_URL, deps.env.STATS_SOLANA_DATABASE_URL]) {
    const url = raw?.trim();
    if (!url) continue;
    try {
      const n = await deps.count(url, WAITLIST_COUNT_SQL);
      if (n !== null) return n;
    } catch {
      // The other database may still hold the row.
    }
  }
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
      return await count(url, sql);
    } catch {
      return null;
    }
  };
  const [stellarAccounts, delivered, solanaAccounts] = await Promise.all([
    safe(stellarUrl, STELLAR_ACCOUNTS_SQL),
    safe(stellarUrl, STELLAR_DELIVERED_SQL),
    safe(solanaUrl, SOLANA_ACCOUNTS_SQL),
  ]);
  if (stellarAccounts === null && solanaAccounts === null) return null;
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

async function settle<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    console.error('[stats] source unavailable:', error instanceof Error ? error.message.slice(0, 80) : 'unknown');
    return null;
  }
}

function countSince(days: readonly string[], start: string, end: string): number {
  return days.filter((d) => d >= start && d <= end).length;
}

export async function loadLiveSnapshot(deps: LiveDeps): Promise<StatsSnapshot> {
  const [sol, stl, waitlist, db, prs] = await Promise.all([
    settle(readSolana(deps)),
    settle(readStellar(deps)),
    settle(readWaitlist(deps)),
    settle(readAppDb(deps)),
    settle(readMergedPrs(deps)),
  ]);
  const base = FALLBACK_SNAPSHOT;
  if (!sol && !stl && waitlist === null && !db && prs === null) return base;

  const now = deps.now();
  const asOf = isoDay(now.getTime());
  const start30 = isoDay(now.getTime() - 29 * DAY_MS);

  // A chain that failed keeps its published day buckets so the chart does not lie by omission.
  const txMap = new Map<string, Point>();
  const cartMap = new Map<string, Point>();
  for (const [chain, read] of [['solana', sol], ['stellar', stl]] as const) {
    if (read) {
      for (const day of read.txDays) bump(txMap, day, chain);
      for (const day of read.cartDays) bump(cartMap, day, chain);
    } else {
      for (const [source, target] of [[base.txDay, txMap], [base.cartDay, cartMap]] as const) {
        for (const p of source) {
          for (let i = 0; i < p[chain]; i++) bump(target, p.iso, chain);
        }
      }
    }
  }

  const b = base.totals;
  const infraSol = sol ? [...sol.wallets].filter((w) => !sol.buyers.has(w)).length : null;
  const infraStl = stl ? [...stl.wallets].filter((w) => !stl.buyers.has(w)).length : null;
  const walletsSolana = sol ? sol.wallets.size : b.walletsSolana;
  const walletsStellar = stl ? stl.wallets.size : b.walletsStellar;
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
    cartsSolana: sol ? sol.opened : b.cartsSolana,
    cartsStellar: stl ? stl.opened : b.cartsStellar,
    settled: sol || stl ? (sol?.settled ?? 0) + (stl?.settled ?? 0) : b.settled,
    settledUsdc: sol ? sol.settledUsdc.toFixed(2) : b.settledUsdc,
    stellarMints: stl ? stl.mintInit : b.stellarMints,
    walletsSolana,
    walletsStellar,
    buyers: Math.max(0, walletsSolana + walletsStellar - infra),
    infra,
    escrowOpen: (sol ? sol.opened : b.cartsSolana) + (stl ? stl.opened : b.cartsStellar),
    escrowRefund: (sol ? sol.refunded : 0) + (stl ? stl.refunded : 0),
    tokenMintInit: (sol ? sol.mintInit : 0) + (stl ? stl.mintInit : 0),
    mergedPrs: prs ?? b.mergedPrs,
    appAccounts: db?.accounts ?? null,
  };
  if (!sol && !stl) {
    totals.escrowOpen = b.escrowOpen;
    totals.settled = b.settled;
    totals.escrowRefund = b.escrowRefund;
    totals.tokenMintInit = b.tokenMintInit;
    totals.txDelta30d = b.txDelta30d;
  }

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
      solana: sol ? 'live' : 'snapshot',
      stellar: stl ? 'live' : 'snapshot',
      waitlist: waitlist === null ? 'snapshot' : 'live',
      appDb: db ? 'live' : 'snapshot',
      github: prs === null ? 'snapshot' : 'live',
    },
  };
}
