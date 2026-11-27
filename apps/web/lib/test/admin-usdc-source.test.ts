import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import type { AdminStore } from '../admin/store.ts';
import { __setUsdcSourceMemoryForTests, type UsdcSourceRow } from '../admin/usdc-source.ts';

/**
 * The operator route writes one key. A missing cookie, a bad CSRF token and
 * a bad body never touch the other row.
 */

const SECRET = 'test-only-admin-secret';
const env = process.env as Record<string, string | undefined>;

describe('admin usdc source route', () => {
  let GET: (req: Request) => Promise<Response>;
  let PUT: (req: Request) => Promise<Response>;
  let cookie: string;
  const rows = new Map<string, UsdcSourceRow>();

  before(async () => {
    env.ADMIN_SESSION_SECRET = SECRET;
    const { signAdminCookie } = await import('../admin/cookie.ts');
    const { __setAdminStoreForTests } = await import('../admin/store.ts');
    const token = await signAdminCookie(
      { exp: Date.now() + 60_000, csrf: 'csrf-test', jti: 'jti-usdc' },
      SECRET,
    );
    assert.ok(token);
    cookie = `chg_admin=${token}`;
    __setAdminStoreForTests({
      sessionByHash: async () => ({ adminId: 'operator' }),
    } as unknown as AdminStore);
    __setUsdcSourceMemoryForTests(rows);
    const route = await import('../../app/api/admin/usdc-source/route.ts');
    GET = route.GET;
    PUT = route.PUT;
  });

  after(async () => {
    __setUsdcSourceMemoryForTests(null);
    rows.clear();
    const { __setAdminStoreForTests } = await import('../admin/store.ts');
    __setAdminStoreForTests(null);
  });

  const put = (body: unknown, headers: Record<string, string> = {}) =>
    PUT(
      new Request('https://admin.changuito.me/api/admin/usdc-source', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie, ...headers },
        body: JSON.stringify(body),
      }),
    );

  it('401 without an admin cookie, and nothing is written', async () => {
    rows.set('usdc_source_guest', { value: 'mock', updatedAt: 't0' });
    const res = await PUT(
      new Request('https://admin.changuito.me/api/admin/usdc-source', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'usdc_source_guest', value: 'circle' }),
      }),
    );
    assert.equal(res.status, 401);
    assert.equal(rows.get('usdc_source_guest')?.value, 'mock');
  });

  it('403 when the CSRF token is missing or wrong, and nothing is written', async () => {
    rows.set('usdc_source_signed_in', { value: 'mock', updatedAt: 't0' });
    const missing = await put({ key: 'usdc_source_signed_in', value: 'circle' });
    assert.equal(missing.status, 403);
    const wrong = await put(
      { key: 'usdc_source_signed_in', value: 'circle' },
      { 'x-csrf-token': 'nope' },
    );
    assert.equal(wrong.status, 403);
    assert.equal(rows.get('usdc_source_signed_in')?.value, 'mock');
  });

  it('400 for a bad key or value, and nothing is written', async () => {
    rows.set('usdc_source_guest', { value: 'mock', updatedAt: 't0' });
    rows.set('usdc_source_signed_in', { value: 'circle', updatedAt: 't1' });
    const badKey = await put({ key: 'usdc_source_other', value: 'circle' }, { 'x-csrf-token': 'csrf-test' });
    const badValue = await put({ key: 'usdc_source_guest', value: 'yes' }, { 'x-csrf-token': 'csrf-test' });
    assert.equal(badKey.status, 400);
    assert.equal(badValue.status, 400);
    assert.equal(rows.get('usdc_source_guest')?.value, 'mock');
    assert.equal(rows.get('usdc_source_signed_in')?.value, 'circle');
    const text = JSON.stringify(await badValue.json());
    assert.equal(text.includes(CIRCLE_ISSUER), false);
  });

  it('writing one key leaves the other untouched', async () => {
    rows.set('usdc_source_guest', { value: 'mock', updatedAt: 't0' });
    rows.set('usdc_source_signed_in', { value: 'mock', updatedAt: 't1' });
    const res = await put(
      { key: 'usdc_source_guest', value: 'circle' },
      { 'x-csrf-token': 'csrf-test' },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.key, 'usdc_source_guest');
    assert.equal(body.value, 'circle');
    assert.equal(typeof body.updatedAt, 'string');
    assert.equal(rows.get('usdc_source_guest')?.value, 'circle');
    assert.equal(rows.get('usdc_source_signed_in')?.value, 'mock');
    assert.equal(rows.get('usdc_source_signed_in')?.updatedAt, 't1');
    const listed = await GET(
      new Request('https://admin.changuito.me/api/admin/usdc-source', { headers: { cookie } }),
    );
    const both = await listed.json();
    const text = JSON.stringify(both);
    assert.equal(text.includes('GBBD47'), false);
    assert.equal(text.includes('CAOPLE'), false);
    assert.equal(both.usdc_source_guest.value, 'circle');
    assert.equal(both.usdc_source_signed_in.value, 'mock');
  });

  it('the operator screen names the sources and not an issuer', () => {
    const page = readFileSync(new URL('../../app/admin-portal/usdc/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /Moneda de prueba/);
    assert.match(page, /Sesión sin iniciar/);
    assert.match(page, /Sesión iniciada/);
    assert.match(page, /role="status"/);
    assert.match(page, /role="alert"/);
    assert.match(page, /minHeight: 44/);
    assert.doesNotMatch(page, /GBBD47/);
    assert.doesNotMatch(page, /GA5ZSE/);
  });
});

const CIRCLE_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
