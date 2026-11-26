/**
 * Visible copy for the stats dashboard. English and Spanish (tú).
 * The language choice is stored in localStorage; the first visit is English.
 */

export type Lang = 'en' | 'es';
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
  langToEs: 'Switch to Spanish',
  langToEn: 'Switch to English',
  langEn: 'EN',
  langEs: 'ES',
  heroTitle: 'Growth, in the open.',
  kpiEndUsers: 'End users (Waitlist)',
  kpiRealPurchases: 'Real purchases (paid in ARS at the supermarket)',
  kpiTx: 'On-chain transactions',
  kpiCarts: 'Escrow carts',
  kpiWallets: 'Wallets',
  kpiRegion: 'Key metrics',
  sep: ' · ',
  delta: '+{count} last 30d',
  realPurchaseNote: 'Escrow runs on Stellar testnet. The supermarket purchases are real.',
  realPurchaseOne: '1 real purchase',
  realPurchaseMany: '{count} real purchases',
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
  unavailable: 'unavailable',
  partialUnavailable: 'Partial · {chain} unavailable',
  appAccounts: '{count} app accounts',
} as const;

const es: { [K in keyof typeof en]: string } = {
  skip: 'Saltar a las métricas',
  brand: 'Changuito',
  badge: 'STATS',
  filtersLabel: 'Filtros',
  networkLabel: 'Red',
  netAll: 'Todas',
  netStellar: 'Stellar',
  netSolana: 'Solana',
  netSeeker: 'Seeker',
  seekerEmpty: 'Sin actividad on-chain publicada',
  rangeLabel: 'Período',
  range7d: '7D',
  range30d: '30D',
  range90d: '90D',
  rangeAll: 'Todo',
  tabLabel: 'Sección',
  tabOverview: 'Resumen',
  tabTransactions: 'Transacciones',
  modeLabel: 'Gráfico',
  modeDaily: 'Diario',
  modeCumulative: 'Acumulado',
  reset: 'Restablecer',
  resetFilters: 'Restablecer filtros',
  exportCsv: 'Exportar CSV',
  emptyChart: 'No hay actividad en este período.',
  emptyTx: 'No hay transacciones publicadas para esta red.',
  themeToLight: 'Cambiar a modo claro',
  themeToDark: 'Cambiar a modo oscuro',
  langToEs: 'Cambiar a español',
  langToEn: 'Cambiar a inglés',
  langEn: 'EN',
  langEs: 'ES',
  heroTitle: 'El crecimiento, a la vista.',
  kpiEndUsers: 'Usuarios finales (lista de espera)',
  kpiRealPurchases: 'Compras reales (pagadas en ARS en el súper)',
  kpiTx: 'Transacciones on-chain',
  kpiCarts: 'Carritos en escrow',
  kpiWallets: 'Wallets',
  kpiRegion: 'Métricas clave',
  sep: ' · ',
  delta: '+{count} en 30 días',
  realPurchaseNote: 'El escrow corre en Stellar testnet. Las compras en el súper son reales.',
  realPurchaseOne: '1 compra real',
  realPurchaseMany: '{count} compras reales',
  txSplit: '{solana} en Solana Devnet, {stellar} en Stellar Testnet',
  cartSplit: '{solana} en Solana, {stellar} en Stellar',
  walletSplit: '{solana} en Solana, {stellar} en Stellar',
  settled: '{count} liquidados',
  usdc: '${amount} USDC',
  mints: '{count} minteos de USDC',
  buyers: '{count} compradores',
  infra: '{count} de infraestructura',
  chainSolana: 'Solana Devnet',
  chainStellar: 'Stellar Testnet',
  chainSeeker: 'Seeker',
  chainShortSolana: 'Solana',
  chainShortStellar: 'Stellar',
  growth: 'Crecimiento on-chain',
  chartTx: 'Transacciones on-chain',
  chartCarts: 'Carritos en escrow',
  legendSolana: 'Solana Devnet',
  legendStellar: 'Stellar Testnet',
  legendSeeker: 'Seeker',
  colTip: '{label}. {leftName} {left}. {rightName} {right}.',
  colTipOne: '{label}. {name} {count}.',
  breakdown: 'Transacciones por red y tipo',
  byNetwork: 'Por red e instrucción',
  engineering: 'Ingeniería y pruebas automáticas',
  passingTests: 'Pruebas que pasan',
  testsScope: 'web + landing',
  mergedPrs: 'PRs fusionados',
  prsScope: 'tote-hq/solana · tote-hq/stellar',
  rowSolana: 'Solana Devnet',
  rowStellar: 'Stellar Testnet',
  rowSeeker: 'Seeker',
  rowOpen: 'Escrow Open',
  rowSettle: 'Escrow Settle',
  rowRefund: 'Escrow Refund',
  rowMint: 'Token Mint & Init',
  solanaBar: '{txs} txs · {carts} carritos · ${amount} USDC',
  stellarBar: '{txs} txs · {carts} carritos · {mints} minteos de USDC',
  countBar: '{count}',
  recent: 'Transacciones verificadas recientes',
  colNetwork: 'Red',
  colTx: 'Transacción',
  colContract: 'Programa',
  linkLabel: '{id}, {hint}',
  newTab: 'se abre en una pestaña nueva',
  filterStatus: 'Mostrando {network}. Período del gráfico {range}.',
  lastKnown: 'último valor conocido',
  unavailable: 'no disponible',
  partialUnavailable: 'Parcial · {chain} no disponible',
  appAccounts: '{count} cuentas en la app',
};

export type MessageKey = keyof typeof en;

export function messages(lang: Lang): { [K in MessageKey]: string } {
  return lang === 'es' ? es : en;
}

export function parseLang(value: string | null | undefined): Lang {
  return value === 'es' ? 'es' : 'en';
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
  return new Intl.NumberFormat(lang === 'es' ? 'es-AR' : 'en-US', { maximumFractionDigits: 0 }).format(value);
}

export function realPurchaseCountLabel(count: number, lang: Lang): string {
  const dict = messages(lang);
  if (count === 1) return dict.realPurchaseOne;
  return format(dict.realPurchaseMany, { count: formatInt(count, lang) });
}

/** Stored choice wins. Anything else, including a first visit, is light. */
export function parseTheme(value: string | null): ThemeName {
  return value === 'dark' ? 'dark' : 'light';
}

export const THEME_KEY = 'changuito.stats.theme';
export const LANG_KEY = 'changuito.stats.lang';
