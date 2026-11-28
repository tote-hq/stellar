import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { messages } from '../stats/i18n.ts';
import { loadLiveSnapshot, STELLAR_DELIVERED_SQL, type QueryFn } from '../stats/live.ts';
import { FALLBACK_SNAPSHOT, STELLAR_CONTRACT_ID } from '../stats/metrics.ts';
import { kpis, kpiMark, kpiTitleKey } from '../stats/view.ts';

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

const COPY = {
  lastKnown: 'last known value',
  unavailable: 'unavailable',
  partialUnavailable: 'Partial · {chain} unavailable',
  chainShortSolana: 'Solana',
  chainShortStellar: 'Stellar',
};

test('published fallback is 52 waitlist signups and 11 settled purchases', () => {
  assert.equal(STELLAR_CONTRACT_ID, ESCROW);
  assert.equal(FALLBACK_SNAPSHOT.totals.endUsers, 52);
  assert.equal(FALLBACK_SNAPSHOT.totals.realPurchases, 11);
  assert.equal(FALLBACK_SNAPSHOT.sources.waitlist, 'snapshot');
  assert.equal(FALLBACK_SNAPSHOT.sources.realPurchases, 'snapshot');
});

test('the dashboard exposes only waitlist, total purchases and total wallets', () => {
  const published = kpis(FALLBACK_SNAPSHOT);
  assert.equal(published.map((card) => card.id).join(','), 'endUsers,realPurchases,wallets');
  assert.equal(published.find((card) => card.id === 'endUsers')?.value, 52);
  assert.equal(published.find((card) => card.id === 'realPurchases')?.value, 11);
  assert.equal(
    published.find((card) => card.id === 'wallets')?.value,
    FALLBACK_SNAPSHOT.totals.walletsSolana + FALLBACK_SNAPSHOT.totals.walletsStellar,
  );
  assert.equal(
    published.some((card) => card.parts.some((part) => part.key === 'realPurchaseNote')),
    false,
  );
  for (const card of published) {
    assert.equal(kpiMark(card.id, FALLBACK_SNAPSHOT, COPY), null);
    assert.equal(card.parts.some((part) => part.key === 'lastKnown'), false);
  }

  const staleWaitlist = kpis({
    ...FALLBACK_SNAPSHOT,
    updatedAt: '2026-11-25T12:00:00.000Z',
    sources: { ...FALLBACK_SNAPSHOT.sources, waitlist: 'snapshot' as const, realPurchases: 'live' as const, solana: 'live' as const, stellar: 'live' as const },
    totals: { ...FALLBACK_SNAPSHOT.totals, realPurchases: 11 },
  });
  const staleSnap = {
    ...FALLBACK_SNAPSHOT,
    updatedAt: '2026-11-25T12:00:00.000Z',
    sources: { ...FALLBACK_SNAPSHOT.sources, waitlist: 'snapshot' as const, realPurchases: 'live' as const, solana: 'live' as const, stellar: 'live' as const },
    totals: { ...FALLBACK_SNAPSHOT.totals, realPurchases: 11 },
  };
  assert.equal(staleWaitlist.find((card) => card.id === 'endUsers')?.value, 52);
  assert.equal(staleWaitlist.find((card) => card.id === 'endUsers')?.parts.some((part) => part.key === 'lastKnown'), false);
  assert.equal(kpiMark('endUsers', staleSnap, COPY), null);
  assert.equal(kpiMark('realPurchases', staleSnap, COPY), null);
  assert.equal(kpiMark('wallets', staleSnap, COPY), null);

  const liveWaitlistSnap = {
    ...FALLBACK_SNAPSHOT,
    updatedAt: '2026-11-25T12:00:00.000Z',
    sources: { ...FALLBACK_SNAPSHOT.sources, waitlist: 'live' as const, realPurchases: 'unavailable' as const, solana: 'unavailable' as const, stellar: 'unavailable' as const },
  };
  const liveWaitlist = kpis({
    ...liveWaitlistSnap,
    totals: { ...FALLBACK_SNAPSHOT.totals, endUsers: 40 },
  });
  assert.equal(liveWaitlist.find((card) => card.id === 'endUsers')?.value, 52);
  assert.equal(liveWaitlist.find((card) => card.id === 'endUsers')?.parts.some((part) => part.key === 'lastKnown'), false);
  assert.equal(liveWaitlist.find((card) => card.id === 'realPurchases')?.parts.some((part) => part.key === 'lastKnown'), true);
  assert.equal(kpiMark('endUsers', liveWaitlistSnap, COPY), null);
  assert.equal(kpiMark('realPurchases', liveWaitlistSnap, COPY), COPY.lastKnown);
  assert.equal(kpiMark('wallets', liveWaitlistSnap, COPY), null);
  assert.equal(liveWaitlist.find((card) => card.id === 'wallets')?.value, 21);

  assert.equal(kpiTitleKey('endUsers'), 'kpiEndUsers');
  assert.equal(kpiTitleKey('realPurchases'), 'kpiRealPurchases');
  assert.equal(kpiTitleKey('wallets'), 'kpiWallets');
});

test('English and Spanish headline copy has no extra commentary', () => {
  const en = messages('en');
  const es = messages('es');
  assert.equal(en.kpiEndUsers, 'Waitlist');
  assert.equal(es.kpiEndUsers, 'Lista de espera');
  assert.equal(en.kpiRealPurchases, 'Total purchases');
  assert.equal(es.kpiRealPurchases, 'Total de compras');
  assert.equal(en.kpiWallets, 'Total wallets');
  assert.equal(es.kpiWallets, 'Total de wallets');
  assert.equal(en.lastKnown, 'last known value');
  assert.equal(es.lastKnown, 'último valor conocido');
  assert.equal(en.heroTitle.includes('\u2013') || en.heroTitle.includes('\u2014'), false);
  assert.equal(es.heroTitle.includes('\u2013') || es.heroTitle.includes('\u2014'), false);
  assert.equal(en.kpiRealPurchases.includes('\u2013') || en.kpiRealPurchases.includes('\u2014'), false);
  assert.equal(es.kpiRealPurchases.includes('\u2013') || es.kpiRealPurchases.includes('\u2014'), false);
});

test('a live Stellar escrow event read supplies the purchases count', async () => {
  const snap = await loadLiveSnapshot({
    fetch: liveFetch({ escrow: 'live' }),
    env: {},
    now: NOW,
    deadlineMs: 400,
    count: async () => null,
  });
  assert.equal(snap.sources.realPurchases, 'live');
  assert.equal(snap.totals.realPurchases, 11);
  const card = kpis(snap).find((item) => item.id === 'realPurchases');
  assert.equal(card?.value, 11);
  assert.equal(card?.parts.some((part) => part.key === 'lastKnown'), false);
  assert.equal(kpiMark('realPurchases', snap, COPY), null);
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
  const card = kpis(snap).find((item) => item.id === 'realPurchases');
  assert.equal(card?.value, 11);
  assert.equal(card?.parts.some((part) => part.key === 'lastKnown'), true);
  assert.equal(kpiMark('realPurchases', snap, COPY), COPY.lastKnown);
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

test('Postgres delivered orders do not feed the purchases box', async () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../stats/live.ts'), 'utf8');
  assert.equal(/realPurchases:\s*db/.test(source), false);
  assert.match(
    source,
    /realPurchases:\s*\(stl\?\.escrowEvents \? stl\.settled : b\.realPurchases\) \+ \(solIx \? solIx\.settled : 0\)/,
  );

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
