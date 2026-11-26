import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { signAdminCookie, verifyAdminCookie } from '../admin/cookie.ts';
import { decideAdmin } from '../admin/gate.ts';

describe('admin gate', () => {
  it('runs before the compare probe and the human gate', () => {
    const src = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    const decide = src.indexOf('await decideAdmin(');
    const probe = src.indexOf("path === '/api/compare/probe'");
    const human = src.indexOf('await resolveHumanGateMode');
    assert.ok(decide > 0 && decide < probe && decide < human);
  });

  it('does not import a key when the secret is blank', async () => {
    const subtle = crypto.subtle;
    const original = subtle.importKey.bind(subtle);
    let called = false;
    subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      called = true;
      return original(...args);
    }) as SubtleCrypto['importKey'];
    try {
      assert.equal(await verifyAdminCookie('a.b', '   '), null);
      assert.equal(await verifyAdminCookie(undefined, ''), null);
      assert.equal(called, false);
    } finally {
      subtle.importKey = original;
    }
  });

  it('keeps the desk off the shopper host and the shopper app off the admin host', async () => {
    const shopper = await decideAdmin({
      url: 'https://app.changuito.me/api/admin/notifications',
      method: 'GET',
      headers: { get: () => null },
    });
    assert.equal(shopper?.status, 404);
    const portal = await decideAdmin({
      url: 'https://admin.changuito.me/admin-portal',
      method: 'GET',
      headers: { get: () => null },
    });
    assert.equal(portal?.status, 404);
    const local = await decideAdmin({
      url: 'http://admin.localhost/',
      method: 'GET',
      headers: { get: () => null },
      nodeEnv: 'production',
    });
    assert.equal(local?.status, 404);
    const login = await decideAdmin({
      url: 'https://admin.changuito.me/?login=failed',
      method: 'GET',
      headers: { get: () => null },
    });
    assert.equal(login?.status, 401);
    assert.match(login?.body ?? '', /data-testid="admin-login"/);
    assert.match(login?.body ?? '', /Usuario o contraseña incorrectos/);
    const open = await decideAdmin({
      url: 'https://admin.changuito.me/api/admin/login',
      method: 'POST',
      headers: { get: () => null },
    });
    assert.equal(open?.status, 200);
    assert.equal(open?.handled, true);
  });

  it('opens the desk at /orders and /orders/, and the viewer page at /orders/:id', async () => {
    const before = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = 'test-only-admin-secret';
    try {
      const token = await signAdminCookie(
        { exp: Date.now() + 60_000, csrf: 'c', jti: 'j' },
        'test-only-admin-secret',
      );
      const headers = { get: (name: string) => (name === 'cookie' ? `chg_admin=${token}` : null) };
      for (const path of ['/orders', '/orders/']) {
        const desk = await decideAdmin({ url: `https://admin.changuito.me${path}`, method: 'GET', headers });
        assert.equal(desk?.status, 200, path);
        assert.equal(desk?.rewrite, '/admin-portal', path);
      }
      const viewer = await decideAdmin({ url: 'https://admin.changuito.me/orders/abc123', method: 'GET', headers });
      assert.equal(viewer?.rewrite, '/admin-portal/orders/abc123');
      const portal = await decideAdmin({ url: 'https://app.changuito.me/admin-portal/orders/abc123', method: 'GET', headers });
      assert.equal(portal?.status, 404);
    } finally {
      if (before === undefined) delete process.env.ADMIN_SESSION_SECRET;
      else process.env.ADMIN_SESSION_SECRET = before;
    }
  });

  it('does not link a note without an order id to /orders/', () => {
    const src = readFileSync(new URL('../../app/admin-portal/page.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /orderId \?\? ''/);
  });
});
