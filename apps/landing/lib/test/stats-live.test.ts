import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HORIZON,
  SOLANA_RPC,
  STELLAR_EXPERT_API,
  loadLiveSnapshot,
  programInstructions,
  readAppDb,
  readWaitlist,
  type LiveDeps,
} from '../stats/live.ts';
import {
  FALLBACK_SNAPSHOT,
  SOLANA_PROGRAM_ID,
  STELLAR_CONTRACT_ID,
  STELLAR_RESOLVER,
  STELLAR_USDC_ID,
} from '../stats/metrics.ts';
import { formatUpdatedAt } from '../stats/i18n.ts';
import { kpis, statsCsv } from '../stats/view.ts';

const NOW = new Date('2026-10-25T12:00:00Z');
const BUYER_SOL = 'Buyer1111111111111111111111111111111111111';
const RESOLVER_SOL = 'Reso1111111111111111111111111111111111111';
const BUYER_STL = `G${'B'.repeat(55)}`;
const SIG = (n: number) => `${n}`.padStart(88, 'S');
const HASH = (n: number) => `${n}`.padStart(64, 'a');
const ts = (iso: string) => Date.parse(iso) / 1000;

function solTx(ix: string, signer: string, at: string, gain = 0) {
  return {
    blockTime: ts(at),
    meta: {
      logMessages: [
        `Program ${SOLANA_PROGRAM_ID} invoke [1]`,
        `Program log: Instruction: ${ix}`,
        'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
        'Program log: Instruction: Transfer',
        'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
        `Program ${SOLANA_PROGRAM_ID} success`,
      ],
      preTokenBalances: [{ accountIndex: 3, uiTokenAmount: { amount: '0', decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 3, uiTokenAmount: { amount: String(gain * 1e6), decimals: 6 } }],
    },
    transaction: { message: { accountKeys: [signer, 'Other'], header: { numRequiredSignatures: 1 } } },
  };
}

const SOL_TXS: Record<string, unknown> = {
  [SIG(1)]: solTx('Open', BUYER_SOL, '2026-10-24T10:00:00Z'),
  [SIG(2)]: solTx('Settle', RESOLVER_SOL, '2026-10-24T11:00:00Z', 12.5),
  [SIG(3)]: solTx('Refund', RESOLVER_SOL, '2026-10-20T11:00:00Z'),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(options: { solanaDown?: boolean; stellarDown?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === SOLANA_RPC) {
      if (options.solanaDown) return json({}, 503);
      const req = JSON.parse(String(init?.body));
      if (req.method === 'getSignaturesForAddress') {
        return json({
          result: [
            { signature: SIG(2), err: null, blockTime: ts('2026-10-24T11:00:00Z') },
            { signature: SIG(1), err: null, blockTime: ts('2026-10-24T10:00:00Z') },
            { signature: SIG(9), err: { InstructionError: [0, { Custom: 1 }] }, blockTime: ts('2026-10-24T09:00:00Z') },
            { signature: SIG(3), err: null, blockTime: ts('2026-10-20T11:00:00Z') },
          ],
        });
      }
      return json({ result: SOL_TXS[req.params[0]] ?? null });
    }
    if (url.startsWith(STELLAR_EXPERT_API) || url.startsWith(HORIZON)) {
      if (options.stellarDown) return json({}, 500);
    }
    if (url.startsWith(`${STELLAR_EXPERT_API}/contract/${STELLAR_CONTRACT_ID}/events`)) {
      return json({
        _embedded: {
          records: [
            { id: '0001-1', ts: ts('2026-09-21T07:00:00Z'), initiator: STELLAR_RESOLVER, topics: ['opened', 'CX', BUYER_STL] },
            { id: '0002-1', ts: ts('2026-09-21T08:00:00Z'), initiator: STELLAR_RESOLVER, topics: ['settled', 'CX'] },
            { id: '0000777-1', ts: ts('2026-09-23T08:00:00Z'), initiator: BUYER_STL, topics: ['refunded', 'CX'] },
          ],
        },
      });
    }
    if (url.startsWith(`${STELLAR_EXPERT_API}/contract/${STELLAR_USDC_ID}/events`)) {
      return json({
        _embedded: { records: [{ id: '0003-0', ts: ts('2026-09-21T06:00:00Z'), initiator: STELLAR_RESOLVER, topics: ['mint', BUYER_STL] }] },
      });
    }
    if (url.startsWith(`${HORIZON}/accounts/${STELLAR_RESOLVER}/transactions`)) {
      return json({
        _embedded: {
          records: [
            { hash: HASH(1), created_at: '2026-09-21T08:00:00Z', successful: true },
            { hash: HASH(2), created_at: '2026-09-21T07:00:00Z', successful: true },
          ],
        },
      });
    }
    if (url.startsWith(`${HORIZON}/accounts/`)) return json({}, 404);
    if (url === `${HORIZON}/operations/777`) {
      return json({ transaction_hash: HASH(3), created_at: '2026-09-23T08:00:00Z', transaction_successful: true });
    }
    if (url.startsWith('https://api.github.com/')) return json({ total_count: 140 });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
}

function deps(over: Partial<LiveDeps> = {}): LiveDeps {
  return { fetch: mockFetch(), env: {}, now: () => NOW, ...over };
}

test('program logs count only our instructions, not nested token calls', () => {
  const logs = (SOL_TXS[SIG(1)] as ReturnType<typeof solTx>).meta.logMessages;
  assert.deepEqual(programInstructions(logs, SOLANA_PROGRAM_ID), ['Open']);
  assert.deepEqual(programInstructions(logs, 'Unrelated'), []);
});

test('live snapshot reads both chains with zero secrets', async () => {
  const snap = await loadLiveSnapshot(deps());
  const t = snap.totals;
  assert.equal(snap.updatedAt, NOW.toISOString());
  assert.equal(snap.asOf, '2026-10-25');
  assert.equal(t.txSolana, 3, 'failed signatures are not counted');
  assert.equal(t.cartsSolana, 1);
  assert.equal(t.settledUsdc, '12.50');
  assert.equal(t.walletsSolana, 2);
  assert.equal(t.txStellar, 3, 'tracked history plus the shopper-signed operation');
  assert.equal(t.cartsStellar, 1);
  assert.equal(t.stellarMints, 1);
  assert.equal(t.walletsStellar, 2);
  assert.equal(t.settled, 2);
  assert.equal(t.escrowRefund, 2);
  assert.equal(t.escrowOpen, 2);
  assert.equal(t.buyers + t.infra, t.walletsSolana + t.walletsStellar);
  assert.equal(t.txDelta30d, 3, 'only Solana activity falls in the 30-day window');
  assert.equal(t.mergedPrs, 140);
  assert.equal(t.endUsers, FALLBACK_SNAPSHOT.totals.endUsers, 'waitlist keeps its last value without env');
  assert.equal(snap.sources.waitlist, 'snapshot');
  assert.equal(snap.sources.solana, 'live');
  assert.equal(snap.sources.stellar, 'live');
  assert.deepEqual(
    snap.txDay.map((p) => [p.iso, p.solana, p.stellar]),
    [
      ['2026-09-21', 0, 2],
      ['2026-09-23', 0, 1],
      ['2026-10-20', 1, 0],
      ['2026-10-24', 2, 0],
    ],
  );
  assert.equal(snap.recentTxs.filter((x) => x.network === 'stellar')[0]?.hash, HASH(3));
  assert.ok(kpis('all', snap)[0]?.parts.some((p) => p.key === 'lastKnown'));
  assert.equal(t.endUsersDelta30d, null, 'a stale delta is not shown on a live page');
  const csv = statsCsv('all', 'all', 'daily', snap);
  assert.match(csv, /^metric,date,label,solana,stellar,seeker\n/);
  assert.match(csv, /tx,2026-10-24,10\/24,2,0,0/);
});

test('the snapshot never carries an address list or a credential', async () => {
  const snap = await loadLiveSnapshot(
    deps({ env: { STATS_STELLAR_DATABASE_URL: 'postgres://stellar' } }),
  );
  const text = JSON.stringify(snap);
  assert.equal(text.includes(BUYER_SOL), false);
  assert.equal(text.includes(BUYER_STL), false);
  assert.equal(text.includes('postgres://stellar'), false);
  assert.equal(snap.totals.endUsers, FALLBACK_SNAPSHOT.totals.endUsers);
  assert.equal(snap.sources.waitlist, 'snapshot');
});

test('one chain down keeps its published numbers and the other stays live', async () => {
  const snap = await loadLiveSnapshot(deps({ fetch: mockFetch({ solanaDown: true }) }));
  assert.equal(snap.sources.solana, 'snapshot');
  assert.equal(snap.sources.stellar, 'live');
  assert.equal(snap.totals.txSolana, FALLBACK_SNAPSHOT.totals.txSolana);
  assert.equal(snap.totals.txStellar, 3);
  const publishedSolana = FALLBACK_SNAPSHOT.txDay.reduce((n, p) => n + p.solana, 0);
  assert.equal(snap.txDay.reduce((n, p) => n + p.solana, 0), publishedSolana);
  assert.ok(snap.recentTxs.some((x) => x.network === 'solana'));
});

test('everything down returns the published snapshot and never throws', async () => {
  const fetchDown = (async () => {
    throw new Error('network unreachable');
  }) as typeof fetch;
  const snap = await loadLiveSnapshot(deps({ fetch: fetchDown }));
  assert.equal(snap, FALLBACK_SNAPSHOT);
  assert.equal(kpis('all', snap)[0]?.parts.some((p) => p.key === 'lastKnown'), false);
});

test('the waitlist figure is not read from the database', async () => {
  assert.equal(await readWaitlist(deps()), null);
  assert.equal(
    await readWaitlist(
      deps({
        env: {
          STATS_STELLAR_DATABASE_URL: 'postgres://stellar',
          STATS_SOLANA_DATABASE_URL: 'postgres://solana',
        },
        count: async () => 9,
      }),
    ),
    null,
  );
  assert.equal(await readAppDb(deps({ count: async () => 5 })), null);
  const seen: string[] = [];
  const db = await readAppDb(
    deps({
      env: { STATS_STELLAR_DATABASE_URL: 'postgres://stellar', STATS_SOLANA_DATABASE_URL: 'postgres://solana' },
      count: async (url, sql) => {
        seen.push(sql);
        if (sql.includes("status = 'done'")) return 1;
        return url.endsWith('stellar') ? 7 : 4;
      },
    }),
  );
  assert.deepEqual(db, { accounts: 11, delivered: 1 });
  assert.ok(seen.every((sql) => /^select count/.test(sql)));
  const broken = await readAppDb(
    deps({
      env: { STATS_STELLAR_DATABASE_URL: 'postgres://stellar' },
      count: async () => {
        throw new Error('connect failed');
      },
    }),
  );
  assert.equal(broken, null);
});

test('the updated-at stamp is localised and names its zone', () => {
  assert.match(formatUpdatedAt('2026-10-25T12:05:00Z', 'en'), /Oct 25, 2026.*12:05.*UTC/);
  assert.match(formatUpdatedAt('2026-10-25T12:05:00Z', 'es'), /25.*oct.*2026.*12:05.*UTC/);
});
