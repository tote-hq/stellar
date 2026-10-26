import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { documentTitle, publicPage } from '../seo.ts';
import {
  format,
  formatInt,
  messages,
  parseTheme,
  phraseLine,
  type MessageKey,
} from '../stats/i18n.ts';
import {
  AS_OF,
  BADGE_INK,
  CART_DAY,
  CART_MONTH,
  ENGINEERING,
  HOME_URL,
  RECENT_TXS,
  SEEKER_COLOR,
  SEEKER_COLOR_DARK,
  SOLANA_COLOR,
  SOLANA_PROGRAM_ID,
  STATS_DESCRIPTION,
  STATS_TITLE,
  STELLAR_COLOR,
  STELLAR_CONTRACT_ID,
  STELLAR_TEXT,
  TOTALS,
  TX_DAY,
  TX_MONTH,
  contractHref,
  shortId,
  txHref,
} from '../stats/metrics.ts';
import {
  engineeringTests,
  kpis,
  networkMeters,
  parseMode,
  parseNetwork,
  parseRange,
  pointsInRange,
  projectSeries,
  rangeStart,
  recentTxs,
  statsCsv,
  sumChain,
  sumSeries,
} from '../stats/view.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function contrast(foreground: string, background: string): number {
  const channel = (hex: string, index: number) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const raw = hex.replace('#', '');
    return 0.2126 * channel(raw, 0) + 0.7152 * channel(raw, 2) + 0.0722 * channel(raw, 4);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test('snapshot totals agree across the day chart, the month chart and the cards', () => {
  assert.equal(sumChain(TX_DAY, 'solana'), 59);
  assert.equal(sumChain(TX_DAY, 'stellar'), 26);
  assert.equal(sumChain(TX_MONTH, 'solana'), sumChain(TX_DAY, 'solana'));
  assert.equal(sumChain(TX_MONTH, 'stellar'), sumChain(TX_DAY, 'stellar'));
  assert.equal(sumChain(CART_DAY, 'solana'), 28);
  assert.equal(sumChain(CART_DAY, 'stellar'), 5);
  assert.equal(sumChain(CART_MONTH, 'solana'), sumChain(CART_DAY, 'solana'));
  assert.equal(sumChain(CART_MONTH, 'stellar'), sumChain(CART_DAY, 'stellar'));
  assert.equal(sumSeries(TX_DAY, 'all'), 85);
  assert.equal(sumSeries(CART_DAY, 'all'), 33);
  assert.equal(TOTALS.walletsSolana + TOTALS.walletsStellar, 21);
  assert.equal(TOTALS.buyers + TOTALS.infra, 21);
  assert.equal(ENGINEERING.reduce((total, row) => total + row.tests, 0), 1484);
  assert.equal(engineeringTests('all'), 1484);
  assert.equal(engineeringTests('solana'), 727);
  assert.equal(engineeringTests('stellar'), 757);
});

test('network filter moves chain metrics and leaves the waitlist in place', () => {
  const all = kpis('all');
  const solana = kpis('solana');
  const stellar = kpis('stellar');
  assert.deepEqual(
    all.map((card) => card.value),
    [30, 85, 33, 21],
  );
  assert.deepEqual(
    solana.map((card) => card.value),
    [30, 59, 28, 13],
  );
  assert.deepEqual(
    stellar.map((card) => card.value),
    [30, 26, 5, 8],
  );
  assert.equal(
    phraseLine(all[1].parts, 'en'),
    '59 on Solana Devnet, 26 on Stellar Testnet · +59 last 30d',
  );
  assert.equal(phraseLine(all[0].parts, 'en'), '+30 last 30d · 1 real order delivered');
  assert.equal(phraseLine(all[2].parts, 'en'), '28 on Solana, 5 on Stellar · 19 settled · $206.99 USDC');
  assert.equal(phraseLine(all[3].parts, 'en'), '13 on Solana, 8 on Stellar · 15 buyers · 6 infra');
  assert.equal(phraseLine(solana[1].parts, 'en'), 'Solana Devnet · +59 last 30d');
  assert.equal(phraseLine(stellar[1].parts, 'en'), 'Stellar Testnet');
  assert.equal(phraseLine(solana[2].parts, 'en'), 'Solana Devnet · $206.99 USDC');
  assert.equal(phraseLine(stellar[2].parts, 'en'), '10 USDC mints');
});

test('cumulative is a running total and raw day buckets stay put', () => {
  const raw = projectSeries(TX_DAY, 'all', false);
  assert.equal(raw[0].stellar, 24);
  assert.equal(raw[2].solana, 20);
  const cumulative = projectSeries(TX_DAY, 'all', true);
  assert.equal(cumulative[0].stellar, 24);
  assert.equal(cumulative[1].stellar, 26);
  assert.equal(cumulative[cumulative.length - 1].solana, 59);
  assert.equal(cumulative[cumulative.length - 1].stellar, 26);
  const solanaOnly = projectSeries(TX_DAY, 'solana', true);
  assert.equal(solanaOnly[solanaOnly.length - 1].stellar, 0);
  assert.equal(solanaOnly[solanaOnly.length - 1].solana, 59);
  let previous = 0;
  for (const bar of cumulative) {
    assert.ok(bar.solana >= previous);
    previous = bar.solana;
  }
});

test('breakdown rows and recent transactions follow the network filter', () => {
  assert.equal(networkMeters('all').length, 6);
  assert.deepEqual(
    networkMeters('all').map((row) => row.value),
    [59, 26, 33, 19, 13, 20],
  );
  assert.equal(phraseLine([networkMeters('all')[0].detail], 'en'), '59 txs · 28 carts · $206.99 USDC');
  assert.equal(phraseLine([networkMeters('all')[1].detail], 'en'), '26 txs · 5 carts · 10 USDC mints');
  assert.equal(networkMeters('solana').length, 1);
  assert.equal(networkMeters('stellar').length, 1);
  assert.equal(recentTxs('all').length, 6);
  assert.equal(recentTxs('solana').length, 4);
  assert.equal(recentTxs('stellar').length, 2);
  const seeker = kpis('seeker');
  assert.deepEqual(
    seeker.map((card) => card.value),
    [30, 0, 0, 0],
  );
  assert.equal(phraseLine(seeker[1].parts, 'en'), 'No published on-chain activity');
  assert.equal(networkMeters('seeker').length, 1);
  assert.equal(networkMeters('seeker')[0].value, 0);
  assert.equal(recentTxs('seeker').length, 0);
  assert.equal(engineeringTests('seeker'), 0);
});

test('range windows stay on the published snapshot day and do not invent rows', () => {
  assert.equal(AS_OF, '2026-10-23');
  assert.equal(rangeStart('7d'), '2026-10-17');
  assert.equal(rangeStart('30d'), '2026-09-24');
  assert.equal(rangeStart('90d'), '2026-07-26');
  assert.equal(rangeStart('all'), null);
  assert.equal(sumSeries(pointsInRange(TX_DAY, '7d'), 'all'), 0);
  assert.equal(sumSeries(pointsInRange(TX_DAY, '30d'), 'solana'), 59);
  assert.equal(sumSeries(pointsInRange(TX_DAY, '30d'), 'stellar'), 0);
  assert.equal(sumSeries(pointsInRange(CART_DAY, '30d'), 'solana'), 28);
  assert.equal(sumSeries(pointsInRange(TX_DAY, '90d'), 'all'), 85);
  assert.equal(sumSeries(pointsInRange(TX_DAY, 'all'), 'seeker'), 0);
  const csv = statsCsv('all', '30d', 'daily');
  assert.match(csv, /^metric,date,label,solana,stellar,seeker\n/);
  assert.equal(csv.includes('2026-09-21'), false);
  assert.match(csv, /tx,2026-10-04,10\/04,20,0,0/);
  assert.equal(statsCsv('seeker', 'all', 'cumulative').includes(',0,0,0'), true);
  assert.equal(parseNetwork('seeker'), 'seeker');
  assert.equal(parseNetwork('nope'), 'all');
  assert.equal(parseRange('30d'), '30d');
  assert.equal(parseRange(null), 'all');
  assert.equal(parseMode('cumulative'), 'cumulative');
  assert.equal(parseMode('daily'), 'daily');
});

test('explorer links use the public program and contract ids', () => {
  assert.equal(RECENT_TXS.length, 6);
  assert.equal(
    txHref(RECENT_TXS[0]),
    `https://solscan.io/tx/${RECENT_TXS[0].hash}?cluster=devnet`,
  );
  assert.equal(
    txHref(RECENT_TXS[4]),
    `https://stellar.expert/explorer/testnet/tx/${RECENT_TXS[4].hash}`,
  );
  for (const tx of RECENT_TXS.filter((item) => item.network === 'stellar')) {
    assert.match(tx.hash, /^[0-9a-f]{64}$/);
  }
  assert.match(STELLAR_CONTRACT_ID, /^C[A-Z2-7]{55}$/);
  const deployments = JSON.parse(readFileSync(join(root, '../../deployments.json'), 'utf8'));
  assert.equal(STELLAR_CONTRACT_ID, deployments.networks.testnet.contracts.escrow.id);
  assert.equal(contractHref('solana'), `https://solscan.io/account/${SOLANA_PROGRAM_ID}?cluster=devnet`);
  assert.equal(
    contractHref('stellar'),
    `https://stellar.expert/explorer/testnet/contract/${STELLAR_CONTRACT_ID}`,
  );
  assert.equal(shortId(RECENT_TXS[0].hash), '2Mty…stCD');
  assert.equal(shortId('40db5af75356'), '40db5af75356');
  assert.equal(HOME_URL, 'https://www.changuito.me');
});

test('english copy is the dashboard default', () => {
  const en = messages('en');
  const keys = Object.keys(en).sort();
  for (const key of keys) {
    const name = key as MessageKey;
    assert.ok(en[name].length > 0, name);
    assert.equal(en[name].includes('{'), placeholders(en[name]).length > 0, name);
  }
  assert.equal(en.heroTitle, 'Growth, in the open.');
  assert.equal(en.exportCsv, 'Export CSV');
  assert.equal(parseTheme(null), 'light');
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('blue'), 'light');
  assert.equal(formatInt(1484, 'en'), '1,484');
  assert.equal(format(en.delta, { count: 59 }), '+59 last 30d');
});

test('the public page title fits the document-title budget', () => {
  const page = publicPage('/stats');
  assert.equal(page.title, STATS_TITLE);
  assert.equal(page.description, STATS_DESCRIPTION);
  assert.ok(page.title.length <= 53, page.title);
  assert.ok(documentTitle(page.title).length <= 60, documentTitle(page.title));
  assert.equal(page.priority, 0.7);
  assert.equal(page.changeFrequency, 'daily');
  assert.ok(page.description.length >= 50 && page.description.length <= 160);
});

test('the dashboard reads copy from the dictionary and the host rewrite is in place', () => {
  const view = readFileSync(join(root, 'components/stats/stats-dashboard.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/stats/stats.module.css'), 'utf8');
  const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
  assert.equal(view.includes('Growth, in the open'), false);
  assert.equal(view.includes('Crecimiento, a la vista'), false);
  assert.match(view, /messages\(lang\)/);
  assert.equal(view.match(/<h1[\s>]/g)?.length, 1);
  assert.match(view, /alt=""/);
  assert.match(view, /data-testid="stats-screen"/);
  assert.equal(view.includes('background-repeat'), false);
  assert.equal(css.includes('background-repeat'), false);
  assert.match(css, /--bg:\s*#FAFAF7/);
  assert.match(css, /--bg:\s*#1C120E/);
  assert.match(css, /--surface:\s*#FFFFFF/);
  assert.match(css, /--surface:\s*#261914/);
  assert.match(css, /--surface-2:\s*#F4EFE6/);
  assert.match(css, /--surface-2:\s*#31201A/);
  assert.match(css, /--text:\s*#2A1A14/);
  assert.match(css, /--text:\s*#FAFAF7/);
  assert.match(css, /--muted:\s*#5C534C/);
  assert.match(css, /--muted:\s*#D7CEC7/);
  assert.match(css, /--bar-solana:\s*#F4B942/);
  assert.match(css, /--bar-stellar:\s*#E07A5F/);
  assert.match(css, /--bar-seeker:\s*#2A1A14/);
  assert.match(css, /--bar-seeker:\s*#F3E3C3/);
  assert.match(css, /#B5482B/);
  assert.match(css, /border-radius:\s*20px/);
  assert.match(css, /border-radius:\s*999px/);
  assert.match(css, /background:\s*#FAFAF7/);
  assert.match(css, /padding:\s*4px 12px/);
  assert.match(css, /min-height:\s*44px/);
  assert.equal(css.toLowerCase().includes('#0f172a'), false);
  assert.equal(css.toLowerCase().includes('#1e293b'), false);
  assert.equal(css.toLowerCase().includes('#8b5cf6'), false);
  assert.equal(css.toLowerCase().includes('#3b82f6'), false);
  assert.match(view, /useState<ThemeName>\('light'\)/);
  assert.match(view, /mascot-idle\.png/);
  assert.match(view, /wordmark\.png/);
  assert.match(view, /data-testid="stats-export"/);
  assert.match(view, /data-testid="stats-footer"/);
  assert.match(view, /value: 'stellar'/);
  assert.ok(view.indexOf("value: 'stellar'") < view.indexOf("value: 'solana'"));
  assert.ok(view.indexOf("value: 'solana'") < view.indexOf("value: 'seeker'"));
  const route = readFileSync(join(root, 'app/stats/export/route.ts'), 'utf8');
  assert.match(route, /statsCsv/);
  assert.match(route, /content-disposition/);
  assert.match(config, /beforeFiles/);
  assert.match(config, /stats\.changuito\.me/);
  assert.match(config, /destination:\s*'\/stats'/);
  const textNodes = [...view.matchAll(/>([^\n<{]+)</g)].map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(textNodes, []);
});

test('both themes clear WCAG AA for text and the brand badges', () => {
  assert.equal(SOLANA_COLOR, '#F4B942');
  assert.equal(STELLAR_COLOR, '#E07A5F');
  assert.equal(SEEKER_COLOR, '#2A1A14');
  assert.equal(SEEKER_COLOR_DARK, '#F3E3C3');
  assert.equal(BADGE_INK, '#2A1A14');
  assert.equal(STELLAR_TEXT, '#B5482B');
  assert.ok(contrast('#2A1A14', '#FAFAF7') >= 4.5);
  assert.ok(contrast('#5C534C', '#FAFAF7') >= 4.5);
  assert.ok(contrast('#2A1A14', '#FFFFFF') >= 4.5);
  assert.ok(contrast('#2A1A14', '#F4EFE6') >= 4.5);
  assert.ok(contrast('#2A1A14', '#F4B942') >= 4.5);
  assert.ok(contrast('#2A1A14', '#E07A5F') >= 4.5);
  assert.ok(contrast(STELLAR_TEXT, '#FFFFFF') >= 4.5);
  assert.ok(contrast(STELLAR_TEXT, '#FAFAF7') >= 4.5);
  assert.ok(contrast('#FAFAF7', '#1C120E') >= 4.5);
  assert.ok(contrast('#FAFAF7', '#261914') >= 4.5);
  assert.ok(contrast('#FAFAF7', '#31201A') >= 4.5);
  assert.ok(contrast('#D7CEC7', '#261914') >= 4.5);
  assert.ok(contrast('#D7CEC7', '#1C120E') >= 4.5);
  assert.ok(contrast('#2A1A14', '#F3E3C3') >= 4.5);
  assert.ok(contrast('#FAFAF7', '#2A1A14') >= 4.5);
  assert.ok(contrast('#F4B942', '#261914') >= 3);
  assert.ok(contrast('#E07A5F', '#261914') >= 3);
  assert.ok(contrast('#F3E3C3', '#261914') >= 3);
  assert.ok(contrast('#2A1A14', '#FAFAF7') >= 3);
});
