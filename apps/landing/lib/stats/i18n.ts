/**
 * Visible copy for the stats dashboard. English only: the language toggle
 * was removed on purpose for this page.
 */

export type Lang = 'en';
export type ThemeName = 'dark' | 'light';

const en = {
  skip: 'Skip to metrics',
  brand: 'Changuito',
  badge: 'STATS',
  filtersLabel: 'Filters',
  networkLabel: 'Network',
  netAll: 'All',
  netStellar: 'Stellar',
  netSolana: 'Solana',
  netSeeker: 'Seeker',
  seekerEmpty: 'No published on-chain activity',
  rangeLabel: 'Range',
  range7d: '7D',
  range30d: '30D',
  range90d: '90D',
  rangeAll: 'All',
  tabLabel: 'Section',
  tabOverview: 'Overview',
  tabTransactions: 'Transactions',
  modeLabel: 'Chart',
  modeDaily: 'Daily',
  modeCumulative: 'Cumulative',
  reset: 'Reset',
  resetFilters: 'Reset filters',
  exportCsv: 'Export CSV',
  emptyChart: 'No activity in this range.',
  emptyTx: 'No published transactions for this network.',
  themeToLight: 'Switch to light mode',
  themeToDark: 'Switch to dark mode',
  heroTitle: 'Growth, in the open.',
  kpiEndUsers: 'End users (Waitlist)',
  kpiTx: 'On-chain transactions',
  kpiCarts: 'Escrow carts',
  kpiWallets: 'Wallets',
  kpiRegion: 'Key metrics',
  sep: ' · ',
  delta: '+{count} last 30d',
  realOrder: '{count} real order delivered',
  txSplit: '{solana} on Solana Devnet, {stellar} on Stellar Testnet',
  cartSplit: '{solana} on Solana, {stellar} on Stellar',
  walletSplit: '{solana} on Solana, {stellar} on Stellar',
  settled: '{count} settled',
  usdc: '${amount} USDC',
  mints: '{count} USDC mints',
  buyers: '{count} buyers',
  infra: '{count} infra',
  chainSolana: 'Solana Devnet',
  chainStellar: 'Stellar Testnet',
  chainSeeker: 'Seeker',
  chainShortSolana: 'Solana',
  chainShortStellar: 'Stellar',
  growth: 'On-chain growth',
  chartTx: 'On-chain transactions',
  chartCarts: 'Escrow carts',
  legendSolana: 'Solana Devnet',
  legendStellar: 'Stellar Testnet',
  legendSeeker: 'Seeker',
  colTip: '{label}. {leftName} {left}. {rightName} {right}.',
  colTipOne: '{label}. {name} {count}.',
  breakdown: 'Transactions by network and type',
  byNetwork: 'By network and instruction',
  engineering: 'Engineering and automated tests',
  passingTests: 'Passing tests',
  testsScope: 'web + landing',
  mergedPrs: 'Merged PRs',
  prsScope: 'tote-hq/solana · tote-hq/stellar',
  rowSolana: 'Solana Devnet',
  rowStellar: 'Stellar Testnet',
  rowSeeker: 'Seeker',
  rowOpen: 'Escrow Open',
  rowSettle: 'Escrow Settle',
  rowRefund: 'Escrow Refund',
  rowMint: 'Token Mint & Init',
  solanaBar: '{txs} txs · {carts} carts · ${amount} USDC',
  stellarBar: '{txs} txs · {carts} carts · {mints} USDC mints',
  countBar: '{count}',
  recent: 'Recent verified transactions',
  colNetwork: 'Network',
  colTx: 'Transaction',
  colContract: 'Program',
  linkLabel: '{id}, {hint}',
  newTab: 'opens in a new tab',
  filterStatus: 'Showing {network}. Chart range {range}.',
  lastKnown: 'last known value',
  appAccounts: '{count} app accounts',
} as const;

export type MessageKey = keyof typeof en;

export function messages(lang: Lang): { [K in MessageKey]: string } {
  void lang;
  return en;
}

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function phraseLine(
  parts: readonly { key: MessageKey; vars?: Record<string, string | number> }[],
  lang: Lang,
): string {
  const dict = messages(lang);
  return parts.map((part) => format(dict[part.key], part.vars)).join(dict.sep);
}

export function formatInt(value: number, lang: Lang): string {
  void lang;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

/** Stored choice wins. Anything else, including a first visit, is light. */
export function parseTheme(value: string | null): ThemeName {
  return value === 'dark' ? 'dark' : 'light';
}

export const THEME_KEY = 'changuito.stats.theme';
