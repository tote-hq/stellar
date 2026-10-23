/**
 * Every visible string on the stats dashboard lives here.
 * The JSX reads keys; it does not carry its own copy.
 */

export type Lang = 'en' | 'es';
export type ThemeName = 'dark' | 'light';

const en = {
  skip: 'Skip to metrics',
  brand: 'Changuito',
  badge: 'Stats',
  back: '← changuito.me',
  networkLabel: 'Network',
  netAll: 'All',
  netSolana: 'Solana',
  netStellar: 'Stellar',
  langLabel: 'Language',
  langEn: 'EN',
  langEs: 'ES',
  themeToLight: 'Switch to light mode',
  themeToDark: 'Switch to dark mode',
  heroTitle: 'Growth, in the open.',
  heroSubtitle: 'Verified on-chain and product metrics across Solana and Stellar.',
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
  chainShortSolana: 'Solana',
  chainShortStellar: 'Stellar',
  growth: 'On-chain growth',
  granularityLabel: 'Bucket',
  month: 'Month',
  day: 'Day',
  cumulative: 'Cumulative',
  chartTx: 'On-chain transactions',
  chartCarts: 'Escrow carts',
  legendSolana: 'Solana Devnet',
  legendStellar: 'Stellar Testnet',
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
  filterStatus: 'Showing {network}',
} as const;

const es: { [K in keyof typeof en]: string } = {
  skip: 'Saltar a las métricas',
  brand: 'Changuito',
  badge: 'Stats',
  back: '← changuito.me',
  networkLabel: 'Red',
  netAll: 'Todas',
  netSolana: 'Solana',
  netStellar: 'Stellar',
  langLabel: 'Idioma',
  langEn: 'EN',
  langEs: 'ES',
  themeToLight: 'Cambiar a modo claro',
  themeToDark: 'Cambiar a modo oscuro',
  heroTitle: 'Crecimiento, a la vista.',
  heroSubtitle: 'Métricas de producto y on-chain verificadas en Solana y Stellar.',
  kpiEndUsers: 'Usuarios finales (lista)',
  kpiTx: 'Transacciones on-chain',
  kpiCarts: 'Carritos en escrow',
  kpiWallets: 'Billeteras',
  kpiRegion: 'Métricas principales',
  sep: ' · ',
  delta: '+{count} últimos 30d',
  realOrder: '{count} pedido real entregado',
  txSplit: '{solana} en Solana Devnet, {stellar} en Stellar Testnet',
  cartSplit: '{solana} en Solana, {stellar} en Stellar',
  walletSplit: '{solana} en Solana, {stellar} en Stellar',
  settled: '{count} liquidados',
  usdc: '${amount} USDC',
  mints: '{count} mints USDC',
  buyers: '{count} compradores',
  infra: '{count} infra',
  chainSolana: 'Solana Devnet',
  chainStellar: 'Stellar Testnet',
  chainShortSolana: 'Solana',
  chainShortStellar: 'Stellar',
  growth: 'Crecimiento on-chain',
  granularityLabel: 'Agrupación',
  month: 'Mes',
  day: 'Día',
  cumulative: 'Acumulado',
  chartTx: 'Transacciones on-chain',
  chartCarts: 'Carritos en escrow',
  legendSolana: 'Solana Devnet',
  legendStellar: 'Stellar Testnet',
  colTip: '{label}. {leftName} {left}. {rightName} {right}.',
  colTipOne: '{label}. {name} {count}.',
  breakdown: 'Transacciones por red y tipo',
  byNetwork: 'Por red e instrucción',
  engineering: 'Ingeniería y tests automáticos',
  passingTests: 'Tests en verde',
  testsScope: 'web + landing',
  mergedPrs: 'PRs mergeados',
  prsScope: 'tote-hq/solana · tote-hq/stellar',
  rowSolana: 'Solana Devnet',
  rowStellar: 'Stellar Testnet',
  rowOpen: 'Escrow abierto',
  rowSettle: 'Escrow liquidado',
  rowRefund: 'Escrow reembolsado',
  rowMint: 'Mint e init de token',
  solanaBar: '{txs} txs · {carts} carritos · ${amount} USDC',
  stellarBar: '{txs} txs · {carts} carritos · {mints} mints USDC',
  countBar: '{count}',
  recent: 'Transacciones verificadas recientes',
  colNetwork: 'Red',
  colTx: 'Transacción',
  colContract: 'Programa',
  linkLabel: '{id}, {hint}',
  newTab: 'se abre en una pestaña nueva',
  filterStatus: 'Mostrando {network}',
};

export type MessageKey = keyof typeof en;

export function messages(lang: Lang): { [K in MessageKey]: string } {
  return lang === 'es' ? es : en;
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
  const locale = lang === 'es' ? 'es-AR' : 'en-US';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Stored choice wins. Anything else, including a first visit, is English. */
export function parseLang(value: string | null): Lang {
  return value === 'es' ? 'es' : 'en';
}

/** Stored choice wins. Anything else, including a first visit, is dark. */
export function parseTheme(value: string | null): ThemeName {
  return value === 'light' ? 'light' : 'dark';
}

export const LANG_KEY = 'changuito.stats.lang';
export const THEME_KEY = 'changuito.stats.theme';
