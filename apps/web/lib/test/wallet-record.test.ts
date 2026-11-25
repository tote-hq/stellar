import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { resetDb, type Sql } from '../db.ts';
import { registerWallet, faucetAdmitted } from '../wallet-record.ts';

describe('faucetAdmitted', () => {
  const closed = { banned: false, faucetAllowed: false };

  it('follows the database flag or the row, and a ban wins', () => {
    assert.equal(faucetAdmitted(closed, true), true);
    assert.equal(faucetAdmitted({ ...closed, faucetAllowed: true }, false), true);
    assert.equal(faucetAdmitted({ banned: true, faucetAllowed: true }, true), false);
    assert.equal(faucetAdmitted(closed, false), false);
  });
});

describe('registerWallet without a database', () => {
  it('does not pretend a row was written', async () => {
    const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const standing = await registerWallet('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', env);
    assert.equal(standing.stored, false);
    assert.equal(standing.banned, false);
    assert.equal(standing.faucetAllowed, false);
    assert.equal(standing.analyticsId, null);
    assert.equal(standing.network, 'testnet');
  });
});

describe('registerWallet analytics id', () => {
  const env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://wallet-test' } as NodeJS.ProcessEnv;

  function memorySql(seed: { network: string; address: string; analytics_id: string | null }[] = []) {
    const rows = new Map<string, { faucet_allowed: boolean; banned: boolean; analytics_id: string | null }>();
    const queries: string[] = [];
    let n = 0;
    for (const row of seed) {
      rows.set(`${row.network}:${row.address}`, { faucet_allowed: false, banned: false, analytics_id: row.analytics_id });
    }
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(' ').replace(/\s+/g, ' ').trim();
      queries.push(text);
      const key = `${String(values[0])}:${String(values[1])}`;
      const lowered = text.toLowerCase();
      if (lowered.startsWith('insert into wallet')) {
        if (rows.has(key)) return Promise.resolve([]);
        n += 1;
        const row = {
          faucet_allowed: false,
          banned: false,
          analytics_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        };
        rows.set(key, row);
        return Promise.resolve([row]);
      }
      if (lowered.startsWith('update wallet')) {
        const row = rows.get(key);
        if (!row || row.analytics_id !== null) return Promise.resolve([]);
        n += 1;
        row.analytics_id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        return Promise.resolve([{ ...row }]);
      }
      if (lowered.startsWith('select ')) {
        const row = rows.get(key);
        return Promise.resolve(row ? [{ ...row }] : []);
      }
      return Promise.reject(new Error(`unexpected sql: ${text}`));
    };
    return { sql: sql as unknown as Sql, queries };
  }

  after(() => {
    resetDb();
  });

  it('assigns an id once, keeps it, fills a missing one, and keeps rows apart', async () => {
    const db = memorySql();
    resetDb(db.sql);
    const address = `G${'A'.repeat(55)}`;
    const other = `G${'B'.repeat(55)}`;

    const first = await registerWallet(address, env);
    const second = await registerWallet(address, env);
    assert.equal(first.stored, true);
    assert.match(first.analyticsId ?? '', /^[0-9a-f-]{36}$/i);
    assert.equal(second.analyticsId, first.analyticsId);
    assert.equal(db.queries.some((query) => /on conflict \(network, address\) do update/i.test(query)), false);
    assert.equal(db.queries.some((query) => /do nothing/i.test(query)), true);
    assert.equal(db.queries.some((query) => /analytics_id is null/i.test(query)), true);

    const sibling = await registerWallet(other, env);
    assert.notEqual(sibling.analyticsId, first.analyticsId);

    const bare = memorySql([{ network: 'testnet', address, analytics_id: null }]);
    resetDb(bare.sql);
    const filled = await registerWallet(address, env);
    assert.match(filled.analyticsId ?? '', /^[0-9a-f-]{36}$/i);
    assert.equal(bare.queries.some((query) => /set analytics_id = gen_random_uuid\(\)/i.test(query)), true);
    const again = await registerWallet(address, env);
    assert.equal(again.analyticsId, filled.analyticsId);
  });
});
