import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { format, messages, phraseLine, realPurchaseCountLabel } from '../stats/i18n.ts';
import { loadLiveSnapshot, STELLAR_DELIVERED_SQL, type QueryFn } from '../stats/live.ts';
import { FALLBACK_SNAPSHOT, STELLAR_CONTRACT_ID } from '../stats/metrics.ts';
import { kpis, kpiTitleKey } from '../stats/view.ts';

const ESCROW = 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S';
const NOW = () => new Date('2026-11-25T12:00:00.000Z');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function events(kinds: readonly string[]): unknown {
  return {
    _embedded: {
      records: kinds.map((kind, index) => ({
        id: `${index + 1}`,
        ts: 1_700_000_000 + index,
        topics: [kind],
        initiator: 'GDFF477UQUWOFIHSOEXPPOD5GPUSEW6OLGZB5FCPS6AFRAOPTMINA55X',
      })),
    },
  };
}

function liveFetch(options: { escrow: 'live' | 'empty' | 'fail'; horizon?: 'empty' | 'fail' }): typeof fetch {
  return async (input) => {
    const href = hrefOf(input);
    if (href.includes(`/contract/${ESCROW}/events`)) {
      if (options.escrow === 'fail') return json({ error: 'down' }, 500);
      if (options.escrow === 'empty') return json(events([]));
      const kinds = [
        ...Array.from({ length: 12 }, () => 'opened'),
        ...Array.from({ length: 11 }, () => 'settled'),
      ];
      return json(events(kinds));
    }
    if (href.includes('/contract/') && href.includes('/events')) return json(events([]));
    if (href.includes('horizon-testnet.stellar.org')) {
      if (options.horizon === 'fail') return json({ error: 'down' }, 500);
      return json({ _embedded: { records: [] } }, 404);
    }
    if (href.includes('api.github.com')) return json({ total_count: 102 });
    if (href.includes('api.devnet.solana.com')) return json({ jsonrpc: '2.0', id: 1, error: { message: 'blocked' } });
    return json({});
  };
}

test('published fallback is 11 Stellar settled purchases, not the old order count', () => {
  assert.equal(STELLAR_CONTRACT_ID, ESCROW);
  assert.equal(FALLBACK_SNAPSHOT.totals.realPurchases, 11);
  assert.equal(FALLBACK_SNAPSHOT.sources.realPurchases, 'snapshot');
});

test('waitlist card no longer carries a real-order line; last known stays on the waitlist number only', () => {
  const published = kpis('all', FALLBACK_SNAPSHOT);
  const waitlist = published.find((card) => card.id === 'endUsers');
  const purchases = published.find((card) => card.id === 'realPurchases');
  assert.ok(waitlist);
  assert.ok(purchases);
  assert.equal(
    waitlist.parts.some((part) => part.key === 'realOrder' || part.key === 'realPurchaseNote'),
    false,
  );
  assert.equal(waitlist.parts.some((part) => part.key === 'lastKnown'), false);
  assert.equal(purchases.value, 11);
  assert.deepEqual(
    purchases.parts.map((part) => part.key),
    ['realPurchaseNote'],
  );

  const staleWaitlist = kpis('all', {
    ...FALLBACK_SNAPSHOT,
    updatedAt: '2026-11-25T12:00:00.000Z',
    sources: { ...FALLBACK_SNAPSHOT.sources, waitlist: 'snapshot', realPurchases: 'live' },
    totals: { ...FALLBACK_SNAPSHOT.totals, realPurchases: 11 },
  });
  const staleUsers = staleWaitlist.find((card) => card.id === 'endUsers');
  const livePurchases = staleWaitlist.find((card) => card.id === 'realPurchases');
  assert.equal(staleUsers?.parts.some((part) => part.key === 'lastKnown'), true);
  assert.equal(livePurchases?.parts.some((part) => part.key === 'lastKnown'), false);

  const liveWaitlist = kpis('all', {
    ...FALLBACK_SNAPSHOT,
    updatedAt: '2026-11-25T12:00:00.000Z',
    sources: { ...FALLBACK_SNAPSHOT.sources, waitlist: 'live', realPurchases: 'unavailable' },
  });
  assert.equal(liveWaitlist.find((card) => card.id === 'endUsers')?.parts.some((part) => part.key === 'lastKnown'), false);
  assert.equal(liveWaitlist.find((card) => card.id === 'realPurchases')?.parts.some((part) => part.key === 'lastKnown'), true);

  const cards = kpis('solana');
  assert.equal(cards.map((card) => card.id).join(','), 'endUsers,realPurchases,transactions,carts,wallets');
  assert.equal(cards.find((card) => card.id === 'realPurchases')?.value, 11);
  assert.equal(kpiTitleKey('realPurchases'), 'kpiRealPurchases');
});

test('English and Spanish purchase copy uses the right plural forms', () => {
  const en = messages('en');
  const es = messages('es');
  assert.equal(en.kpiRealPurchases, 'Real purchases (paid in ARS at the supermarket)');
  assert.equal(es.kpiRealPurchases, 'Compras reales (pagadas en ARS en el súper)');
  assert.equal(en.realPurchaseNote, 'Escrow runs on Stellar testnet. The supermarket purchases are real.');
  assert.equal(es.realPurchaseNote, 'El escrow corre en Stellar testnet. Las compras en el súper son reales.');
  assert.equal(realPurchaseCountLabel(1, 'en'), '1 real purchase');
  assert.equal(realPurchaseCountLabel(11, 'en'), '11 real purchases');
  assert.equal(realPurchaseCountLabel(1, 'es'), '1 compra real');
  assert.equal(realPurchaseCountLabel(11, 'es'), '11 compras reales');
  assert.equal(en.lastKnown, 'last known value');
  assert.equal(es.lastKnown, 'último valor conocido');

  const lineEn = phraseLine(kpis('all').find((card) => card.id === 'realPurchases')?.parts ?? [], 'en');
  const lineEs = phraseLine(kpis('all').find((card) => card.id === 'realPurchases')?.parts ?? [], 'es');
  assert.equal(lineEn, en.realPurchaseNote);
  assert.equal(lineEs, es.realPurchaseNote);
  assert.equal(lineEn.includes('last known'), false);
  assert.match(format(en.realPurchaseMany, { count: 2 }), /2 real purchases/);
  assert.match(format(es.realPurchaseMany, { count: 2 }), /2 compras reales/);
});

test('a live Stellar escrow event read supplies the real-purchases count', async () => {
  const snap = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'live' }),
    env: {},
    now: NOW,
    deadlineMs: 400,
    count: async () => null,
  });
  assert.equal(snap.sources.realPurchases, 'live');
  assert.equal(snap.totals.realPurchases, 11);
  const card = kpis('all', snap).find((item) => item.id === 'realPurchases');
  assert.equal(card?.value, 11);
  assert.equal(card?.parts.some((part) => part.key === 'lastKnown'), false);
});

test('a successful escrow event read of zero settled purchases is shown as zero', async () => {
  const snap = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'empty' }),
    env: {},
    now: NOW,
    deadlineMs: 400,
    count: async () => null,
  });
  assert.equal(snap.sources.realPurchases, 'live');
  assert.equal(snap.totals.realPurchases, 0);
});

test('when the escrow event read fails, the card keeps 11 and says last known value', async () => {
  const snap = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'fail', horizon: 'fail' }),
    env: {},
    now: NOW,
    deadlineMs: 400,
    count: async () => null,
  });
  assert.equal(snap.sources.realPurchases, 'unavailable');
  assert.equal(snap.totals.realPurchases, 11);
  const card = kpis('all', snap).find((item) => item.id === 'realPurchases');
  assert.equal(card?.value, 11);
  assert.equal(card?.parts.some((part) => part.key === 'lastKnown'), true);
});

test('Horizon history alone does not count as a live purchases read', async () => {
  const snap = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'fail', horizon: 'empty' }),
    env: {},
    now: NOW,
    deadlineMs: 400,
    count: async () => null,
  });
  assert.equal(snap.sources.realPurchases, 'unavailable');
  assert.equal(snap.totals.realPurchases, 11);
});

test('Postgres delivered orders do not feed the real-purchases box', async () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../stats/live.ts'), 'utf8');
  assert.equal(/realPurchases:\s*db/.test(source), false);
  assert.match(source, /realPurchases:\s*stl\?\.escrowEvents \? stl\.settled : b\.realPurchases/);

  const count: QueryFn = async (_url, sql) => {
    if (sql === STELLAR_DELIVERED_SQL) return 99;
    return 0;
  };
  const snap = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'live' }),
    env: { STATS_STELLAR_DATABASE_URL: 'postgres://stats.example/app' },
    now: NOW,
    deadlineMs: 400,
    count,
  });
  assert.equal(snap.totals.realPurchases, 11);
  assert.notEqual(snap.totals.realPurchases, 99);

  const failed = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'fail', horizon: 'fail' }),
    env: { STATS_STELLAR_DATABASE_URL: 'postgres://stats.example/app' },
    now: NOW,
    deadlineMs: 400,
    count,
  });
  assert.equal(failed.totals.realPurchases, 11);
  assert.notEqual(failed.totals.realPurchases, 99);
});
