/**
 * Turns the snapshot into what a filter, a range and a chart mode show.
 * The waitlist is one product number, so the end-user card stays put when a
 * network is selected. Chain counts move. Seeker has no published rows, so
 * that filter is zeros rather than a split we do not have.
 */

import type { MessageKey } from './i18n.ts';
import {
  AS_OF,
  CART_DAY,
  CART_MONTH,
  ENGINEERING,
  RECENT_TXS,
  TOTALS,
  TX_DAY,
  TX_MONTH,
  type EngineeringRow,
  type Point,
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
  id: 'endUsers' | 'transactions' | 'carts' | 'wallets';
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

export function pointsFor(kind: SeriesKind, granularity: Granularity): readonly Point[] {
  if (kind === 'tx') return granularity === 'month' ? TX_MONTH : TX_DAY;
  return granularity === 'month' ? CART_MONTH : CART_DAY;
}

/** Inclusive start of a window ending on the published snapshot day. */
export function rangeStart(range: RangeId): string | null {
  if (range === 'all') return null;
  const span = range === '7d' ? 6 : range === '30d' ? 29 : 89;
  const start = Date.parse(`${AS_OF}T00:00:00Z`) - span * DAY_MS;
  return new Date(start).toISOString().slice(0, 10);
}

export function pointsInRange(points: readonly Point[], range: RangeId): Point[] {
  const start = rangeStart(range);
  if (!start) return [...points];
  return points.filter((point) => point.iso >= start && point.iso <= AS_OF);
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

export function chartBars(kind: SeriesKind, range: RangeId, filter: NetworkFilter, mode: ChartMode): Bar[] {
  return projectSeries(pointsInRange(pointsFor(kind, 'day'), range), filter, mode === 'cumulative');
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

export function kpis(filter: NetworkFilter): Kpi[] {
  const endUsers: Kpi = {
    id: 'endUsers',
    value: TOTALS.endUsers,
    parts: [
      { key: 'delta', vars: { count: TOTALS.endUsersDelta30d } },
      { key: 'realOrder', vars: { count: TOTALS.realOrders } },
    ],
  };

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

  return [endUsers, transactions, carts, wallets];
}

const INSTRUCTION_ROWS: readonly { id: string; count: number; label: MessageKey }[] = [
  { id: 'open', count: TOTALS.escrowOpen, label: 'rowOpen' },
  { id: 'settle', count: TOTALS.settled, label: 'rowSettle' },
  { id: 'refund', count: TOTALS.escrowRefund, label: 'rowRefund' },
  { id: 'mint', count: TOTALS.tokenMintInit, label: 'rowMint' },
];

/**
 * Network rows follow the filter. Instruction totals are not split by chain
 * in the snapshot, so they stay on All rather than being attributed to one rail.
 * Seeker has no published instruction split.
 */
export function networkMeters(filter: NetworkFilter): Meter[] {
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
    for (const row of INSTRUCTION_ROWS) {
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

export function recentTxs(filter: NetworkFilter): readonly TxRef[] {
  return RECENT_TXS.filter((tx) => filter === 'all' || tx.network === filter);
}

export function networkNameKey(filter: NetworkFilter): MessageKey {
  if (filter === 'solana') return 'netSolana';
  if (filter === 'stellar') return 'netStellar';
  if (filter === 'seeker') return 'netSeeker';
  return 'netAll';
}

export function kpiTitleKey(id: Kpi['id']): MessageKey {
  if (id === 'endUsers') return 'kpiEndUsers';
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
export function statsCsv(filter: NetworkFilter, range: RangeId, mode: ChartMode): string {
  const lines = ['metric,date,label,solana,stellar,seeker'];
  for (const kind of ['tx', 'carts'] as const) {
    const points = pointsInRange(pointsFor(kind, 'day'), range);
    const bars = projectSeries(points, filter, mode === 'cumulative');
    points.forEach((point, index) => {
      const bar = bars[index];
      if (!bar) return;
      lines.push([kind, point.iso, point.label, bar.solana, bar.stellar, bar.seeker].map(csvCell).join(','));
    });
  }
  return `${lines.join('\n')}\n`;
}
