import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

/**
 * The three 401s that write admin_login_failure. The log is a branch name,
 * never the password, the hash, or the session secret.
 */

const verify = {
  mode: 'false' as 'false' | 'true' | 'throw',
  errorName: 'CompileError',
};

mock.module('hash-wasm', {
  namedExports: {
    argon2Verify: async () => {
      if (verify.mode === 'throw') {
        const err = new Error('wasm');
        err.name = verify.errorName;
        throw err;
      }
      return verify.mode === 'true';
    },
  },
});

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
const HASH = 'hash-should-not-leak';
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
    verify.mode = 'false';
    verify.errorName = 'CompileError';
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

  const post = async (username = 'simoneth') => {
    const res = await POST(
      new Request('https://admin.changuito.me/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
      }),
    );
    return { status: res.status, body: (await res.json()) as { error?: string } };
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

  it('logs verify_false when the user exists and argon2Verify returns false', async () => {
    db.user = { id: 'user-1', passwordHash: HASH };
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, ['[admin/login] 401 verify_false']);
    assert.equal(db.recorded, 1);
    assertSafe();
  });

  it('logs verify_threw plus the error name when argon2Verify throws', async () => {
    db.user = { id: 'user-1', passwordHash: HASH };
    verify.mode = 'throw';
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Usuario o contraseña incorrectos.' });
    assert.deepEqual(logs, ['[admin/login] 401 verify_threw:CompileError']);
    assert.equal(db.recorded, 1);
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
