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
  parseLang,
  parseTheme,
  phraseLine,
  type MessageKey,
} from '../stats/i18n.ts';
import {
  CART_DAY,
  CART_MONTH,
  ENGINEERING,
  HOME_URL,
  RECENT_TXS,
  SOLANA_PROGRAM_ID,
  STATS_DESCRIPTION,
  STATS_TITLE,
  STELLAR_CONTRACT_ID,
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
  projectSeries,
  recentTxs,
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
  assert.equal(phraseLine(all[0].parts, 'es'), '+30 últimos 30d · 1 pedido real entregado');
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
});

test('explorer links use the public program and contract ids', () => {
  assert.equal(RECENT_TXS.length, 6);
  assert.equal(
    txHref(RECENT_TXS[0]),
    `https://solscan.io/tx/${RECENT_TXS[0].hash}?cluster=devnet`,
  );
  assert.equal(
    txHref(RECENT_TXS[4]),
    'https://stellar.expert/explorer/testnet/tx/40db5af75356',
  );
  assert.equal(
    txHref(RECENT_TXS[5]),
    'https://stellar.expert/explorer/testnet/tx/6527e00093',
  );
  assert.equal(contractHref('solana'), `https://solscan.io/account/${SOLANA_PROGRAM_ID}?cluster=devnet`);
  assert.equal(
    contractHref('stellar'),
    `https://stellar.expert/explorer/testnet/contract/${STELLAR_CONTRACT_ID}`,
  );
  assert.equal(shortId(RECENT_TXS[0].hash), '2Mty…stCD');
  assert.equal(shortId('40db5af75356'), '40db5af75356');
  assert.equal(HOME_URL, 'https://www.changuito.me');
});

test('english and spanish dictionaries share keys, placeholders and a default', () => {
  const en = messages('en');
  const es = messages('es');
  const keys = Object.keys(en).sort();
  assert.deepEqual(keys, Object.keys(es).sort());
  for (const key of keys) {
    const name = key as MessageKey;
    assert.ok(en[name].length > 0, name);
    assert.ok(es[name].length > 0, name);
    assert.deepEqual(placeholders(en[name]), placeholders(es[name]), name);
  }
  assert.equal(en.heroTitle, 'Growth, in the open.');
  assert.notEqual(en.heroTitle, es.heroTitle);
  assert.equal(parseLang(null), 'en');
  assert.equal(parseLang('es'), 'es');
  assert.equal(parseLang('en'), 'en');
  assert.equal(parseLang('fr'), 'en');
  assert.equal(parseTheme(null), 'dark');
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('blue'), 'dark');
  assert.equal(formatInt(1484, 'en'), '1,484');
  assert.equal(formatInt(1484, 'es'), '1.484');
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
  assert.match(css, /--bg:\s*#0f172a/);
  assert.match(css, /--surface:\s*#1e293b/);
  assert.match(css, /--border:\s*#334155/);
  assert.match(css, /--text:\s*#f8fafc/);
  assert.match(css, /--bg:\s*#ffffff/);
  assert.match(css, /--surface:\s*#f8fafc/);
  assert.match(css, /--border:\s*#e5e7eb/);
  assert.match(css, /--text:\s*#0f172a/);
  assert.match(css, /--bar-solana:\s*#8b5cf6/);
  assert.match(css, /--bar-stellar:\s*#3b82f6/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(config, /beforeFiles/);
  assert.match(config, /stats\.changuito\.me/);
  assert.match(config, /destination:\s*'\/stats'/);
  const textNodes = [...view.matchAll(/>([^\n<{]+)</g)].map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(textNodes, []);
});

test('both themes clear WCAG AA for text and the series colors clear non-text contrast', () => {
  assert.ok(contrast('#f8fafc', '#0f172a') >= 4.5);
  assert.ok(contrast('#f8fafc', '#1e293b') >= 4.5);
  assert.ok(contrast('#94a3b8', '#1e293b') >= 4.5);
  assert.ok(contrast('#93c5fd', '#1e293b') >= 4.5);
  assert.ok(contrast('#0f172a', '#f8fafc') >= 4.5);
  assert.ok(contrast('#0f172a', '#ffffff') >= 4.5);
  assert.ok(contrast('#475569', '#ffffff') >= 4.5);
  assert.ok(contrast('#475569', '#f8fafc') >= 4.5);
  assert.ok(contrast('#1d4ed8', '#f8fafc') >= 4.5);
  assert.ok(contrast('#ffffff', '#0f172a') >= 4.5);
  assert.ok(contrast('#7dd3fc', '#0f172a') >= 3);
  assert.ok(contrast('#1d4ed8', '#ffffff') >= 3);
  assert.ok(contrast('#8b5cf6', '#1e293b') >= 3);
  assert.ok(contrast('#8b5cf6', '#f8fafc') >= 3);
  assert.ok(contrast('#3b82f6', '#1e293b') >= 3);
  assert.ok(contrast('#3b82f6', '#f8fafc') >= 3);
  assert.ok(contrast('#94a3b8', '#334155') >= 3);
  assert.ok(contrast('#64748b', '#e5e7eb') >= 3);
});
