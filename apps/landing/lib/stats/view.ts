/**
 * Turns the snapshot into what a filter, a range and a chart mode show.
 * The waitlist and the real-purchases figures are product numbers, so those
 * cards stay put when a network is selected. Chain counts move. Seeker has
 * no published rows, so that filter is zeros rather than a split we do not have.
 */

import { format, type MessageKey } from './i18n.ts';
import {
  ENGINEERING,
  FALLBACK_SNAPSHOT,
  monthBuckets,
  type EngineeringRow,
  type Point,
  type SourceState,
  type StatsSnapshot,
  type TxRef,
} from './metrics.ts';

export type NetworkFilter = 'all' | 'solana' | 'stellar' | 'seeker';
export type Chain = 'solana' | 'stellar' | 'seeker';
export type Granularity = 'month' | 'day';
export type SeriesKind = 'tx' | 'carts';
export type RangeId = '7d' | '30d' | '90d' | 'all';
export type ChartMode = 'daily' | 'cumulative';

export interface Phrase {
  key: MessageKey;
  vars?: Record<string, string | number>;
}

export interface Kpi {
  id: 'endUsers' | 'realPurchases' | 'transactions' | 'carts' | 'wallets';
  value: number;
  parts: Phrase[];
}

export interface Bar {
  label: string;
  solana: number;
  stellar: number;
  seeker: number;
}

export interface Meter {
  id: string;
  label: Phrase | null;
  labelText: string | null;
  detail: Phrase;
  value: number;
  tone: 'solana' | 'stellar' | 'seeker' | 'neutral';
}

const DAY_MS = 86_400_000;

export function sumChain(points: readonly Point[], chain: 'solana' | 'stellar'): number {
  return points.reduce((total, point) => total + point[chain], 0);
}

export function sumSeries(points: readonly Point[], filter: NetworkFilter): number {
  if (filter === 'seeker') return 0;
  return points.reduce((total, point) => {
    const solana = filter === 'stellar' ? 0 : point.solana;
    const stellar = filter === 'solana' ? 0 : point.stellar;
    return total + solana + stellar;
  }, 0);
}

export function pointsFor(
  kind: SeriesKind,
  granularity: Granularity,
  snap: StatsSnapshot = FALLBACK_SNAPSHOT,
): readonly Point[] {
  const days = kind === 'tx' ? snap.txDay : snap.cartDay;
  return granularity === 'month' ? monthBuckets(days) : days;
}

/** Inclusive start of a window ending on the published snapshot day. */
export function rangeStart(range: RangeId, asOf: string = FALLBACK_SNAPSHOT.asOf): string | null {
  if (range === 'all') return null;
  const span = range === '7d' ? 6 : range === '30d' ? 29 : 89;
  const start = Date.parse(`${asOf}T00:00:00Z`) - span * DAY_MS;
  return new Date(start).toISOString().slice(0, 10);
}

export function pointsInRange(
  points: readonly Point[],
  range: RangeId,
  asOf: string = FALLBACK_SNAPSHOT.asOf,
): Point[] {
  const start = rangeStart(range, asOf);
  if (!start) return [...points];
  return points.filter((point) => point.iso >= start && point.iso <= asOf);
}

/** Running totals when cumulative is on. A hidden chain, including Seeker, stays at zero. */
export function projectSeries(points: readonly Point[], filter: NetworkFilter, cumulative: boolean): Bar[] {
  let solana = 0;
  let stellar = 0;
  return points.map((point) => {
    const nextSolana = filter === 'all' || filter === 'solana' ? point.solana : 0;
    const nextStellar = filter === 'all' || filter === 'stellar' ? point.stellar : 0;
    solana += nextSolana;
    stellar += nextStellar;
    if (cumulative) return { label: point.label, solana, stellar, seeker: 0 };
    return { label: point.label, solana: nextSolana, stellar: nextStellar, seeker: 0 };
  });
}

export function chartBars(
  kind: SeriesKind,
  range: RangeId,
  filter: NetworkFilter,
  mode: ChartMode,
  snap: StatsSnapshot = FALLBACK_SNAPSHOT,
): Bar[] {
  return projectSeries(pointsInRange(pointsFor(kind, 'day', snap), range, snap.asOf), filter, mode === 'cumulative');
}

export function seriesPeak(bars: readonly Bar[], filter: NetworkFilter): number {
  let peak = 0;
  for (const bar of bars) {
    if (filter === 'all' || filter === 'solana') peak = Math.max(peak, bar.solana);
    if (filter === 'all' || filter === 'stellar') peak = Math.max(peak, bar.stellar);
    if (filter === 'seeker') peak = Math.max(peak, bar.seeker);
  }
  return peak;
}

export function plotTop(peak: number): number {
  return Math.max(peak, 1);
}

export function barRatio(value: number, top: number): number {
  if (top <= 0) return 0;
  return value / top;
}

export function visibleChains(filter: NetworkFilter): Chain[] {
  if (filter === 'solana') return ['solana'];
  if (filter === 'stellar') return ['stellar'];
  if (filter === 'seeker') return ['seeker'];
  return ['solana', 'stellar'];
}

const SEEKER_PARTS: Phrase[] = [{ key: 'seekerEmpty' }];

export function kpis(filter: NetworkFilter, snap: StatsSnapshot = FALLBACK_SNAPSHOT): Kpi[] {
  const TOTALS = snap.totals;
  const userParts: Phrase[] = [];
  if (TOTALS.endUsersDelta30d !== null) userParts.push({ key: 'delta', vars: { count: TOTALS.endUsersDelta30d } });
  if (TOTALS.appAccounts !== null) userParts.push({ key: 'appAccounts', vars: { count: TOTALS.appAccounts } });
  if (snap.updatedAt !== null && snap.sources.waitlist !== 'live') userParts.push({ key: 'lastKnown' });
  const endUsers: Kpi = { id: 'endUsers', value: TOTALS.endUsers, parts: userParts };
  // Real purchases are Stellar settled escrows (ARS supermarket payments).
  // The box stays put when a network is selected. last-known applies only
  // when the escrow event read failed.
  const purchaseParts: Phrase[] = [{ key: 'realPurchaseNote' }];
  if (snap.updatedAt !== null && snap.sources.realPurchases !== 'live') purchaseParts.push({ key: 'lastKnown' });
  const realPurchases: Kpi = { id: 'realPurchases', value: TOTALS.realPurchases, parts: purchaseParts };

  const transactions: Kpi =
    filter === 'seeker'
      ? { id: 'transactions', value: 0, parts: SEEKER_PARTS }
      : filter === 'solana'
        ? {
            id: 'transactions',
            value: TOTALS.txSolana,
            parts: [{ key: 'chainSolana' }, { key: 'delta', vars: { count: TOTALS.txDelta30d } }],
          }
        : filter === 'stellar'
          ? {
              id: 'transactions',
              value: TOTALS.txStellar,
              parts: [{ key: 'chainStellar' }],
            }
          : {
              id: 'transactions',
              value: TOTALS.txSolana + TOTALS.txStellar,
              parts: [
                { key: 'txSplit', vars: { solana: TOTALS.txSolana, stellar: TOTALS.txStellar } },
                { key: 'delta', vars: { count: TOTALS.txDelta30d } },
              ],
            };

  const carts: Kpi =
    filter === 'seeker'
      ? { id: 'carts', value: 0, parts: SEEKER_PARTS }
      : filter === 'solana'
        ? {
            id: 'carts',
            value: TOTALS.cartsSolana,
            parts: [{ key: 'chainSolana' }, { key: 'usdc', vars: { amount: TOTALS.settledUsdc } }],
          }
        : filter === 'stellar'
          ? {
              id: 'carts',
              value: TOTALS.cartsStellar,
              parts: [{ key: 'mints', vars: { count: TOTALS.stellarMints } }],
            }
          : {
              id: 'carts',
              value: TOTALS.cartsSolana + TOTALS.cartsStellar,
              parts: [
                { key: 'cartSplit', vars: { solana: TOTALS.cartsSolana, stellar: TOTALS.cartsStellar } },
                { key: 'settled', vars: { count: TOTALS.settled } },
                { key: 'usdc', vars: { amount: TOTALS.settledUsdc } },
              ],
            };

  const wallets: Kpi =
    filter === 'seeker'
      ? { id: 'wallets', value: 0, parts: SEEKER_PARTS }
      : filter === 'solana'
        ? { id: 'wallets', value: TOTALS.walletsSolana, parts: [{ key: 'chainShortSolana' }] }
        : filter === 'stellar'
          ? { id: 'wallets', value: TOTALS.walletsStellar, parts: [{ key: 'chainShortStellar' }] }
          : {
              id: 'wallets',
              value: TOTALS.walletsSolana + TOTALS.walletsStellar,
              parts: [
                { key: 'walletSplit', vars: { solana: TOTALS.walletsSolana, stellar: TOTALS.walletsStellar } },
                { key: 'buyers', vars: { count: TOTALS.buyers } },
                { key: 'infra', vars: { count: TOTALS.infra } },
              ],
            };

  return [endUsers, realPurchases, transactions, carts, wallets];
}

function instructionRows(snap: StatsSnapshot): { id: string; count: number; label: MessageKey }[] {
  const t = snap.totals;
  return [
    { id: 'open', count: t.escrowOpen, label: 'rowOpen' },
    { id: 'settle', count: t.settled, label: 'rowSettle' },
    { id: 'refund', count: t.escrowRefund, label: 'rowRefund' },
    { id: 'mint', count: t.tokenMintInit, label: 'rowMint' },
  ];
}

/**
 * Network rows follow the filter. Instruction totals are not split by chain
 * in the snapshot, so they stay on All rather than being attributed to one rail.
 * Seeker has no published instruction split.
 */
export function networkMeters(filter: NetworkFilter, snap: StatsSnapshot = FALLBACK_SNAPSHOT): Meter[] {
  const TOTALS = snap.totals;
  if (filter === 'seeker') {
    return [
      {
        id: 'seeker',
        label: { key: 'rowSeeker' },
        labelText: null,
        detail: { key: 'seekerEmpty' },
        value: 0,
        tone: 'seeker',
      },
    ];
  }
  const rows: Meter[] = [];
  if (filter !== 'stellar') {
    rows.push({
      id: 'solana',
      label: { key: 'rowSolana' },
      labelText: null,
      detail: {
        key: 'solanaBar',
        vars: { txs: TOTALS.txSolana, carts: TOTALS.cartsSolana, amount: TOTALS.settledUsdc },
      },
      value: TOTALS.txSolana,
      tone: 'solana',
    });
  }
  if (filter !== 'solana') {
    rows.push({
      id: 'stellar',
      label: { key: 'rowStellar' },
      labelText: null,
      detail: {
        key: 'stellarBar',
        vars: { txs: TOTALS.txStellar, carts: TOTALS.cartsStellar, mints: TOTALS.stellarMints },
      },
      value: TOTALS.txStellar,
      tone: 'stellar',
    });
  }
  if (filter === 'all') {
    for (const row of instructionRows(snap)) {
      rows.push({
        id: row.id,
        label: { key: row.label },
        labelText: null,
        detail: { key: 'countBar', vars: { count: row.count } },
        value: row.count,
        tone: 'neutral',
      });
    }
  }
  return rows;
}

export function engineeringRows(filter: NetworkFilter): readonly EngineeringRow[] {
  return ENGINEERING.filter((row) => filter === 'all' || row.chain === filter);
}

export function engineeringMeters(filter: NetworkFilter): Meter[] {
  return engineeringRows(filter).map((row) => ({
    id: row.id,
    label: null,
    labelText: row.label,
    detail: { key: 'countBar', vars: { count: row.tests } },
    value: row.tests,
    tone: row.chain,
  }));
}

export function engineeringTests(filter: NetworkFilter): number {
  return engineeringRows(filter).reduce((total, row) => total + row.tests, 0);
}

export function meterPeak(rows: readonly Meter[]): number {
  return rows.reduce((peak, row) => Math.max(peak, row.value), 0);
}

export function recentTxs(filter: NetworkFilter, snap: StatsSnapshot = FALLBACK_SNAPSHOT): readonly TxRef[] {
  return snap.recentTxs.filter((tx) => filter === 'all' || tx.network === filter);
}

export function networkNameKey(filter: NetworkFilter): MessageKey {
  if (filter === 'solana') return 'netSolana';
  if (filter === 'stellar') return 'netStellar';
  if (filter === 'seeker') return 'netSeeker';
  return 'netAll';
}

export function kpiTitleKey(id: Kpi['id']): MessageKey {
  if (id === 'endUsers') return 'kpiEndUsers';
  if (id === 'realPurchases') return 'kpiRealPurchases';
  if (id === 'transactions') return 'kpiTx';
  if (id === 'carts') return 'kpiCarts';
  return 'kpiWallets';
}

export function parseNetwork(value: string | null): NetworkFilter {
  if (value === 'solana' || value === 'stellar' || value === 'seeker') return value;
  return 'all';
}

export function parseRange(value: string | null): RangeId {
  if (value === '7d' || value === '30d' || value === '90d') return value;
  return 'all';
}

export function parseMode(value: string | null): ChartMode {
  return value === 'cumulative' ? 'cumulative' : 'daily';
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Chart rows for the current network, range and mode. No account data. */
export function statsCsv(
  filter: NetworkFilter,
  range: RangeId,
  mode: ChartMode,
  snap: StatsSnapshot = FALLBACK_SNAPSHOT,
): string {
  const lines = ['metric,date,label,solana,stellar,seeker'];
  for (const kind of ['tx', 'carts'] as const) {
    const points = pointsInRange(pointsFor(kind, 'day', snap), range, snap.asOf);
    const bars = projectSeries(points, filter, mode === 'cumulative');
    points.forEach((point, index) => {
      const bar = bars[index];
      if (!bar) return;
      lines.push([kind, point.iso, point.label, bar.solana, bar.stellar, bar.seeker].map(csvCell).join(','));
    });
  }
  return `${lines.join('\n')}\n`;
}


/** Combined chain badge for a filter. 'partial' is All when only one chain failed. */
export type ChainViewState = SourceState | 'partial';

/** Live only when every chain on screen was read. Both failed is unavailable; one failed is partial. */
export function chainState(filter: NetworkFilter, snapshot: StatsSnapshot): ChainViewState | null {
  if (snapshot.updatedAt === null || filter === 'seeker') return null;
  const states: SourceState[] =
    filter === 'solana'
      ? [snapshot.sources.solana]
      : filter === 'stellar'
        ? [snapshot.sources.stellar]
        : [snapshot.sources.solana, snapshot.sources.stellar];
  if (states.every((state) => state === 'live')) return 'live';
  const failed = states.filter((state) => state === 'unavailable');
  if (failed.length === states.length && failed.length > 0) return 'unavailable';
  if (failed.length > 0) return 'partial';
  return 'snapshot';
}

export function sourceLabel(state: SourceState | null, lastKnown: string, unavailable: string): string | null {
  if (state === 'unavailable') return unavailable;
  if (state === 'snapshot') return lastKnown;
  return null;
}

/** Text badge for a chain card. Color is never the only signal. */
export function chainSourceLabel(
  filter: NetworkFilter,
  snapshot: StatsSnapshot,
  copy: {
    lastKnown: string;
    unavailable: string;
    partialUnavailable: string;
    chainShortSolana: string;
    chainShortStellar: string;
  },
): string | null {
  const state = chainState(filter, snapshot);
  if (state === 'unavailable') return copy.unavailable;
  if (state === 'snapshot') return copy.lastKnown;
  if (state === 'partial') {
    const chain =
      snapshot.sources.solana === 'unavailable'
        ? copy.chainShortSolana
        : snapshot.sources.stellar === 'unavailable'
          ? copy.chainShortStellar
          : '';
    return format(copy.partialUnavailable, { chain });
  }
  return null;
}
