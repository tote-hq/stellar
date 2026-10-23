/**
 * Public snapshot behind /stats.
 *
 * Counts are aggregates the team already published: no account, no email,
 * no postal code. Chain ids are the public program and the public contract
 * the dashboard links to. Day buckets sum to the month buckets; the tests
 * pin that so a hand edit cannot leave the two charts disagreeing.
 */

export const STATS_TITLE = 'Public Stats & On-Chain Metrics';

export const STATS_DESCRIPTION =
  'Verified on-chain and product metrics for Changuito across both networks.';

export const HOME_URL = 'https://www.changuito.me';

/** Published snapshot day. Range windows count back from this, never from the clock. */
export const AS_OF = '2026-10-23';

/** Series fills. Text badges use the ink paired with a fill that clears WCAG AA. */
export const SOLANA_COLOR = '#F4B942';
export const STELLAR_COLOR = '#E07A5F';
export const SEEKER_COLOR = '#2A1A14';
export const SEEKER_COLOR_DARK = '#F3E3C3';
/** Espresso on sunflower, and espresso on arcilla, both clear 4.5:1. */
export const BADGE_INK = '#2A1A14';
export const STELLAR_TEXT = '#B5482B';

export const SOLANA_PROGRAM_ID = 'BFa1gZL9kVVo8Mq5gaDRM5RiCG4NDiyHLbpymfXvLz9d';
export const STELLAR_CONTRACT_ID = 'CCH37422N756N7747422N7';

export const TOTALS = {
  endUsers: 30,
  endUsersDelta30d: 30,
  realOrders: 1,
  txSolana: 59,
  txStellar: 26,
  txDelta30d: 59,
  cartsSolana: 28,
  cartsStellar: 5,
  settled: 19,
  settledUsdc: '206.99',
  stellarMints: 10,
  walletsSolana: 13,
  walletsStellar: 8,
  buyers: 15,
  infra: 6,
  escrowOpen: 33,
  escrowRefund: 13,
  tokenMintInit: 20,
  mergedPrs: 102,
} as const;

export interface Point {
  label: string;
  /** Calendar day of the bucket, UTC. Range filters use this. */
  iso: string;
  solana: number;
  stellar: number;
}

export const TX_DAY: readonly Point[] = [
  { label: '09/21', iso: '2026-09-21', solana: 0, stellar: 24 },
  { label: '09/23', iso: '2026-09-23', solana: 0, stellar: 2 },
  { label: '10/04', iso: '2026-10-04', solana: 20, stellar: 0 },
  { label: '10/09', iso: '2026-10-09', solana: 9, stellar: 0 },
  { label: '10/10', iso: '2026-10-10', solana: 6, stellar: 0 },
  { label: '10/11', iso: '2026-10-11', solana: 24, stellar: 0 },
];

export const TX_MONTH: readonly Point[] = [
  { label: '09/26', iso: '2026-09-26', solana: 0, stellar: 26 },
  { label: '10/26', iso: '2026-10-26', solana: 59, stellar: 0 },
];

export const CART_DAY: readonly Point[] = [
  { label: '09/21', iso: '2026-09-21', solana: 0, stellar: 5 },
  { label: '09/23', iso: '2026-09-23', solana: 0, stellar: 0 },
  { label: '10/04', iso: '2026-10-04', solana: 9, stellar: 0 },
  { label: '10/09', iso: '2026-10-09', solana: 4, stellar: 0 },
  { label: '10/10', iso: '2026-10-10', solana: 3, stellar: 0 },
  { label: '10/11', iso: '2026-10-11', solana: 12, stellar: 0 },
];

export const CART_MONTH: readonly Point[] = [
  { label: '09/26', iso: '2026-09-26', solana: 0, stellar: 5 },
  { label: '10/26', iso: '2026-10-26', solana: 28, stellar: 0 },
];

export interface EngineeringRow {
  id: string;
  label: string;
  chain: 'solana' | 'stellar';
  tests: number;
}

export const ENGINEERING: readonly EngineeringRow[] = [
  { id: 'web-stellar', label: '@changuito/web · stellar', chain: 'stellar', tests: 682 },
  { id: 'web-solana', label: '@changuito/web · solana', chain: 'solana', tests: 650 },
  { id: 'landing-solana', label: '@changuito/landing · solana', chain: 'solana', tests: 77 },
  { id: 'landing-stellar', label: '@changuito/landing · stellar', chain: 'stellar', tests: 75 },
];

export interface TxRef {
  network: 'solana' | 'stellar';
  hash: string;
}

export const RECENT_TXS: readonly TxRef[] = [
  {
    network: 'solana',
    hash: '2Mty3w4CJ4hxxMH3gNqruonJSSgxDbFirhzQqvNpo4UtTUfzp1A1hRbSG8qSNzmVGhUe4Jdvv1pjWa6ju1s5stCD',
  },
  {
    network: 'solana',
    hash: '5viAna58Hxc18QcjQB87mSXJCiYc8n3GAhePPKRQvzHufKx9RReKt5F9LTK6vGwVBZLFuM6Np5jK3fAu9tQpcmUy',
  },
  {
    network: 'solana',
    hash: '2tjg8EzmJoTgveUHG2K9UZUuiinTTiHWPknMewV2CsSHjbvKqh6r1rtEjT5544UHVkPi9SZiZ1CTHkzyL3mE4Jq4',
  },
  {
    network: 'solana',
    hash: '5qBwCrxeHhd2ePMRSyYQek5g4sHeJfcANZJQXaxGMF5XYjy9BSqsK1kLWZMRfCEvPvgnfX6b6ty6jKDxu4kmnWeo',
  },
  { network: 'stellar', hash: '40db5af75356' },
  { network: 'stellar', hash: '6527e00093' },
];

export function txHref(tx: TxRef): string {
  if (tx.network === 'solana') return `https://solscan.io/tx/${tx.hash}?cluster=devnet`;
  return `https://stellar.expert/explorer/testnet/tx/${tx.hash}`;
}

export function contractHref(network: TxRef['network']): string {
  if (network === 'solana') return `https://solscan.io/account/${SOLANA_PROGRAM_ID}?cluster=devnet`;
  return `https://stellar.expert/explorer/testnet/contract/${STELLAR_CONTRACT_ID}`;
}

export function contractId(network: TxRef['network']): string {
  return network === 'solana' ? SOLANA_PROGRAM_ID : STELLAR_CONTRACT_ID;
}

/** Short public id for a table cell. Full value stays on the link. */
export function shortId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
