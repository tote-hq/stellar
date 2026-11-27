import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { __setPostgresFactoryForTests, db, resetDb, runInDbRequest, type Sql } from '../db.ts';

/**
 * A postgres.js stand-in. `hang` leaves the query open until `end` rejects it,
 * which is what a second request used to do to the first.
 */
function fakeClient(hang: boolean): { sql: Sql; ended: () => boolean } {
  let ended = false;
  let rejectHang: ((err: Error) => void) | undefined;
  const query = () => {
    if (ended) return Promise.reject(new Error('client ended'));
    if (!hang) return Promise.resolve([{ n: 0 }]);
    return new Promise((_resolve, reject) => {
      rejectHang = reject;
    });
  };
  const sql = Object.assign(query, {
    end() {
      ended = true;
      rejectHang?.(new Error('client ended'));
      return Promise.resolve();
    },
  });
  return { sql: sql as unknown as Sql, ended: () => ended };
}

describe('db request scope', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevRequest = process.env.CHG_DB_REQUEST;

  afterEach(() => {
    resetDb();
    __setPostgresFactoryForTests();
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevRequest === undefined) delete process.env.CHG_DB_REQUEST;
    else process.env.CHG_DB_REQUEST = prevRequest;
  });

  it('ends an in-flight query when another request id replaces the shared client', async () => {
    process.env.DATABASE_URL = 'postgres://scope-test';
    process.env.CHG_DB_REQUEST = 'req-a';
    const first = fakeClient(true);
    const second = fakeClient(false);
    const made = [first, second];
    let n = 0;
    __setPostgresFactoryForTests(() => made[n++]!.sql);

    const inflight = db()`select n from quota where key = ${'guest'}`;
    process.env.CHG_DB_REQUEST = 'req-b';
    db();

    await assert.rejects(inflight, /client ended/);
    assert.equal(first.ended(), true);
    assert.equal(second.ended(), false);
  });

  it('keeps each overlapping request on its own client', async () => {
    process.env.DATABASE_URL = 'postgres://scope-test';
    const first = fakeClient(false);
    const second = fakeClient(false);
    const made = [first, second];
    let n = 0;
    __setPostgresFactoryForTests(() => made[n++]!.sql);

    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const taskA = runInDbRequest(async () => {
      const client = db();
      assert.equal(db(), client, 'one request keeps the client it opened');
      await hold;
      return client`select n from quota where key = ${'archive'}`;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rows = await runInDbRequest(async () => db()`select n from quota where key = ${'seguir'}`);
    assert.deepEqual(rows, [{ n: 0 }]);
    assert.equal(first.ended(), false, 'the other request ended this client');
    assert.equal(second.ended(), false);
    assert.equal(n, 2);

    release();
    assert.deepEqual(await taskA, [{ n: 0 }]);
    assert.equal(first.ended(), false);
  });
});
