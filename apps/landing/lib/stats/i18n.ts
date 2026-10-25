/**
 * Every visible string on the stats dashboard lives here.
 * The JSX reads keys; it does not carry its own copy.
 */

export type Lang = 'en' | 'es';
export type ThemeName = 'dark' | 'light';

const en = {
  skip: 'Skip to metrics',
  brand: 'Changuito',
  badge: 'STATS',
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
  exportCsv: 'Export CSV',
  emptyChart: 'No activity in this range.',
  emptyTx: 'No published transactions for this network.',
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
  updatedAt: 'Updated {time}',
  liveNote: 'Live from Solana Devnet and Stellar Testnet. Refreshes every 5 minutes.',
  snapshotNote: 'Live data is unavailable right now. Showing the last published snapshot.',
  partialNote: 'Some sources are unavailable. Those figures show their last known value.',
} as const;

const es: { [K in keyof typeof en]: string } = {
  skip: 'Saltar a las métricas',
  brand: 'Changuito',
  badge: 'STATS',
  networkLabel: 'Red',
  netAll: 'Todas',
  netStellar: 'Stellar',
  netSolana: 'Solana',
  netSeeker: 'Seeker',
  seekerEmpty: 'Sin actividad on-chain publicada',
  rangeLabel: 'Rango',
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
  exportCsv: 'Exportar CSV',
  emptyChart: 'Sin actividad en este rango.',
  emptyTx: 'Sin transacciones publicadas para esta red.',
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
  engineering: 'Ingeniería y tests automáticos',
  passingTests: 'Tests en verde',
  testsScope: 'web + landing',
  mergedPrs: 'PRs mergeados',
  prsScope: 'tote-hq/solana · tote-hq/stellar',
  rowSolana: 'Solana Devnet',
  rowStellar: 'Stellar Testnet',
  rowSeeker: 'Seeker',
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
  filterStatus: 'Mostrando {network}. Rango del gráfico {range}.',
  lastKnown: 'último valor conocido',
  appAccounts: '{count} cuentas en la app',
  updatedAt: 'Actualizado {time}',
  liveNote: 'En vivo desde Solana Devnet y Stellar Testnet. Se actualiza cada 5 minutos.',
  snapshotNote: 'Los datos en vivo no están disponibles ahora. Se muestra la última foto publicada.',
  partialNote: 'Algunas fuentes no están disponibles. Esas cifras muestran su último valor conocido.',
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

/** Date and time in the reader's language, with the zone named so it is unambiguous. */
export function formatUpdatedAt(iso: string, lang: Lang): string {
  const locale = lang === 'es' ? 'es-AR' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** Stored choice wins. Anything else, including a first visit, is English. */
export function parseLang(value: string | null): Lang {
  return value === 'es' ? 'es' : 'en';
}

/** Stored choice wins. Anything else, including a first visit, is light. */
export function parseTheme(value: string | null): ThemeName {
  return value === 'dark' ? 'dark' : 'light';
}

export const LANG_KEY = 'changuito.stats.lang';
export const THEME_KEY = 'changuito.stats.theme';
