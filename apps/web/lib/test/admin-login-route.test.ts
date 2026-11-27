import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

/**
 * The three 401s that write admin_login_failure. The log is a branch name,
 * never the password, the hash, or the session secret.
 */

const db = {
  user: null as { id: string; passwordHash: string } | null,
  failures: 0,
  recorded: 0,
};

mock.module(new URL('../admin/store.ts', import.meta.url).href, {
  namedExports: {
    adminStore: () => ({
      userByName: async () => db.user,
      failureCount: async () => db.failures,
      recordFailure: async () => {
        db.recorded += 1;
      },
      saveSession: async () => {},
    }),
  },
});

const PASSWORD = 'wrong-probe';
const HASH =
  'pbkdf2-sha256$100000$cm91dGUtc2FsdC0xNmJ5dGU$M0yjG2iGwKpTlThqm5pC1ktw3CCUGetzyaqTGXTqOro';
const PLAIN = 'plain-fixture';
const BROKEN_PBKDF2 = 'pbkdf2-sha256$100000$not-valid$also-not';
const SECRET = 'test-admin-session';

describe('POST /api/admin/login 401 branch', () => {
  let POST: (req: Request) => Promise<Response>;
  const realError = console.error;
  let logs: string[] = [];
  const savedSecret = process.env.ADMIN_SESSION_SECRET;

  before(async () => {
    process.env.ADMIN_SESSION_SECRET = SECRET;
    POST = (await import('../../app/api/admin/login/route.ts')).POST;
  });

  beforeEach(() => {
    db.user = null;
    db.failures = 0;
    db.recorded = 0;
    logs = [];
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
  });

  after(() => {
    console.error = realError;
    if (savedSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = savedSecret;
  });

  const post = async (username = 'simoneth', password = PASSWORD) => {
    const res = await POST(
      new Request('https://admin.changuito.me/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }),
    );
    return {
      status: res.status,
      cookie: res.headers.get('set-cookie'),
      body: (await res.json()) as { error?: string; csrf?: string },
    };
  };

  const assertSafe = () => {
    const text = logs.join('\n');
    assert.equal(text.includes(PASSWORD), false);
    assert.equal(text.includes(HASH), false);
    assert.equal(text.includes(SECRET), false);
  };

  it('logs user_missing and keeps the 401 copy', async () => {
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, ['[admin/login] 401 user_missing']);
    assert.equal(db.recorded, 1);
    assertSafe();
  });

  it('logs verify_false when the user exists and the verifier rejects the password', async () => {
    db.user = { id: 'user-1', passwordHash: HASH };
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, ['[admin/login] 401 verify_false']);
    assert.equal(db.recorded, 1);
    assertSafe();
  });

  it('accepts a password stored as the password_hash text and does not log it', async () => {
    db.user = { id: 'user-1', passwordHash: PLAIN };
    const res = await post('simoneth', PLAIN);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.csrf, 'string');
    assert.equal(res.cookie?.includes('chg_admin='), true);
    assert.deepEqual(logs, []);
    assert.equal(db.recorded, 0);
    assert.equal(JSON.stringify(logs).includes(PLAIN), false);
  });

  it('logs verify_false when the stored text is not the password', async () => {
    db.user = { id: 'user-1', passwordHash: PLAIN };
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, ['[admin/login] 401 verify_false']);
    assert.equal(db.recorded, 1);
    assert.equal(logs.join('\n').includes(PLAIN), false);
    assertSafe();
  });

  it('logs verify_threw plus the error name when a pbkdf2 hash is broken', async () => {
    db.user = { id: 'user-1', passwordHash: BROKEN_PBKDF2 };
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, ['[admin/login] 401 verify_threw:Error']);
    assert.equal(db.recorded, 1);
    assert.equal(logs.join('\n').includes(BROKEN_PBKDF2), false);
    assertSafe();
  });

  it('does not log a branch when the rate limit answers first', async () => {
    db.failures = 5;
    db.user = { id: 'user-1', passwordHash: HASH };
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, []);
    assert.equal(db.recorded, 0);
  });
});
