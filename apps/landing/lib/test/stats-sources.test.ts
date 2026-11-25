import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { format, messages } from '../stats/i18n.ts';
import { readAppDb, readMergedPrs, safeError, type LiveDeps, type QueryFn } from '../stats/live.ts';
import { FALLBACK_SNAPSHOT, STELLAR_CONTRACT_ID, type StatsSnapshot } from '../stats/metrics.ts';
import { chainSourceLabel, chainState } from '../stats/view.ts';

const copy = messages('en');

function snapshot(sources: Partial<StatsSnapshot['sources']>, updated = true): StatsSnapshot {
  return {
    ...FALLBACK_SNAPSHOT,
    updatedAt: updated ? '2026-11-24T12:00:00.000Z' : null,
    sources: { ...FALLBACK_SNAPSHOT.sources, ...sources },
  };
}

test('STELLAR_CONTRACT_ID matches the testnet escrow in deployments.json', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../deployments.json');
  const deployments = JSON.parse(readFileSync(root, 'utf8')) as {
    networks: { testnet: { contracts: { escrow: { id: string } } } };
  };
  const expected = deployments.networks.testnet.contracts.escrow.id;
  assert.equal(expected, 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S');
  assert.equal(STELLAR_CONTRACT_ID, expected);
  assert.notEqual(STELLAR_CONTRACT_ID, 'CCA3ES6ANWAAJXB436XTSPGFRGX5GDZLHC7UOF25K4B5OFDJML4JG7EX');
});

test('All view is partial when only one chain is unavailable', () => {
  const solanaDown = snapshot({ solana: 'unavailable', stellar: 'live' });
  assert.equal(chainState('all', solanaDown), 'partial');
  assert.equal(chainState('solana', solanaDown), 'unavailable');
  assert.equal(chainState('stellar', solanaDown), 'live');
  assert.equal(chainSourceLabel('all', solanaDown, copy), 'Partial · Solana unavailable');
  assert.equal(chainSourceLabel('stellar', solanaDown, copy), null);

  const stellarDown = snapshot({ solana: 'live', stellar: 'unavailable' });
  assert.equal(chainState('all', stellarDown), 'partial');
  assert.equal(chainSourceLabel('all', stellarDown, copy), 'Partial · Stellar unavailable');

  const bothDown = snapshot({ solana: 'unavailable', stellar: 'unavailable' });
  assert.equal(chainState('all', bothDown), 'unavailable');
  assert.equal(chainSourceLabel('all', bothDown, copy), copy.unavailable);

  const bothLive = snapshot({ solana: 'live', stellar: 'live' });
  assert.equal(chainState('all', bothLive), 'live');
  assert.equal(chainSourceLabel('all', bothLive, copy), null);

  const published = snapshot({ solana: 'unavailable', stellar: 'live' }, false);
  assert.equal(chainState('all', published), null);
  assert.equal(chainSourceLabel('all', published, copy), null);
});

test('partialUnavailable keeps a text label, not color alone', () => {
  const label = format(copy.partialUnavailable, { chain: copy.chainShortSolana });
  assert.match(label, /Partial/);
  assert.match(label, /Solana/);
  assert.match(label, /unavailable/);
});

test('safeError keeps the code and strips URLs and credentials', () => {
  const timeout = new DOMException('stats deadline', 'TimeoutError');
  assert.match(safeError(timeout), /TimeoutError/);
  assert.match(safeError(timeout), /stats deadline/);

  const leakedUrl = 'postgres:' + '//reader:' + 'fake-pass' + '@db.example:5432/app';
  const timedOut = Object.assign(new Error('write CONNECT_TIMEOUT ' + leakedUrl), {
    name: 'PostgresError',
    code: 'CONNECT_TIMEOUT',
  });
  const timedOutText = safeError(timedOut);
  assert.match(timedOutText, /CONNECT_TIMEOUT/);
  assert.equal(timedOutText.includes('postgres:'), false);
  assert.equal(timedOutText.includes('fake-pass'), false);
  assert.equal(timedOutText.includes('db.example'), false);

  const auth = new Error('password authentication failed for user "reader" at ' + leakedUrl);
  const authText = safeError(auth);
  assert.match(authText, /password authentication failed/);
  assert.equal(authText.includes('fake-pass'), false);
  assert.equal(authText.includes('postgres:'), false);
});

test('readAppDb logs a safe cause when Postgres fails', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  const count: QueryFn = async () => {
    const leakedUrl = 'postgres:' + '//reader:' + 'fake-pass' + '@db.internal:5432/app';
    throw Object.assign(new Error('connect ' + leakedUrl), {
      name: 'PostgresError',
      code: 'CONNECT_TIMEOUT',
    });
  };
  try {
    await readAppDb({
      fetch: (() => Promise.reject(new Error('unused'))) as unknown as typeof fetch,
      env: { STATS_STELLAR_DATABASE_URL: 'configured' },
      now: () => new Date('2026-11-24T12:00:00.000Z'),
      count,
    });
    assert.fail('expected readAppDb to throw');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'app db unavailable');
  } finally {
    console.error = original;
  }

  const joined = lines.join('\n');
  assert.match(joined, /\[stats\] app-db stellar-accounts failed:/);
  assert.match(joined, /CONNECT_TIMEOUT/);
  assert.equal(joined.includes('postgres:'), false);
  assert.equal(joined.includes('fake-pass'), false);
  assert.equal(joined.includes('db.internal'), false);
});

test('readMergedPrs sends a bearer token only when STATS_GITHUB_TOKEN is set', async () => {
  const seen: Array<HeadersInit | undefined> = [];
  const fetchImpl: typeof fetch = ((_input, init) => {
    seen.push(init?.headers);
    return Promise.resolve(
      new Response(JSON.stringify({ total_count: 8 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  const base: Omit<LiveDeps, 'env'> = {
    fetch: fetchImpl,
    now: () => new Date('2026-11-24T12:00:00.000Z'),
  };

  assert.equal(await readMergedPrs({ ...base, env: {} }), 8);
  const anonymous = new Headers(seen[0]);
  assert.equal(anonymous.get('authorization'), null);
  assert.equal(anonymous.get('user-agent'), 'changuito-stats');

  seen.length = 0;
  assert.equal(await readMergedPrs({ ...base, env: { STATS_GITHUB_TOKEN: '  test-github-token  ' } }), 8);
  const authed = new Headers(seen[0]);
  assert.equal(authed.get('authorization'), 'Bearer test-github-token');
});
