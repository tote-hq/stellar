import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { verifyAdminCookie } from '../admin/cookie.ts';
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
});