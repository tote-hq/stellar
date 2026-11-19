import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  EXPIRING_SOON_SEC,
  type StorageState,
  type StoredSession,
  authCookies,
  describeSpan,
  isUsable,
  profileFromOrderForm,
  readSession,
  saveSession,
  sessionHealth,
} from '../checkout/session-store.js';

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);

function state(cookies: Array<Partial<StorageState['cookies'][number]>>): StorageState {
  return {
    cookies: cookies.map((c) => ({
      name: 'x', value: 'v', domain: '.dia', path: '/', expires: -1, ...c,
    })) as StorageState['cookies'],
    origins: [],
  };
}

function session(cookies: Parameters<typeof state>[0], savedAt = new Date(NOW - 3_600_000).toISOString()): StoredSession {
  return {
    meta: { savedAt, retailer: 'dia', host: 'diaonline.supermercadosdia.com.ar', account: 'me@example.com' },
    state: state(cookies),
  };
}

describe('authCookies', () => {
  it('finds the platform cookie and the per-account one', () => {
    const s = state([
      { name: 'VtexIdclientAutCookie' },
      { name: 'VtexIdclientAutCookie_ardiaprod' },
      { name: 'checkout.vtex.com' },
    ]);
    assert.deepEqual(authCookies(s).map((c) => c.name), [
      'VtexIdclientAutCookie',
      'VtexIdclientAutCookie_ardiaprod',
    ]);
  });
});

describe('sessionHealth', () => {
  it('reports no session at all', () => {
    const h = sessionHealth(undefined, NOW);
    assert.equal(h.status, 'no_auth_cookie');
    assert.match(h.message, /link_marketplace_account/);
    assert.equal(isUsable(h), false);
  });

  it('is ok when the cookie has hours left', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + 7200 }]),
      NOW,
    );
    assert.equal(h.status, 'ok');
    assert.equal(h.secondsLeft, 7200);
    assert.equal(isUsable(h), true);
  });

  it('warns when less time is left than a checkout takes', () => {
    const earliest = sessionHealth(
      session([
        { name: 'VtexIdclientAutCookie', expires: sec(NOW) + 86_400 },
        { name: 'VtexIdclientAutCookie_ardiaprod', expires: sec(NOW) + 600 },
      ]),
      NOW,
    );
    assert.equal(earliest.status, 'expiring_soon');
    assert.equal(earliest.secondsLeft, 600);

    const close = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + EXPIRING_SOON_SEC - 1 }]),
      NOW,
    );
    assert.equal(close.status, 'expiring_soon');
    assert.equal(isUsable(close), false, 'must not start a payment on a session about to die');

    const boundary = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + EXPIRING_SOON_SEC }]),
      NOW,
    );
    assert.equal(boundary.status, 'expiring_soon');
  });

  it('reports an expired session and how long ago', () => {
    const h = sessionHealth(
      session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) - 7200 }]),
      NOW,
    );
    assert.equal(h.status, 'expired');
    assert.match(h.message, /expired 2\.0 h ago/);
    assert.equal(isUsable(h), false);
  });

  it('admits it cannot tell for a session cookie, rather than guessing', () => {
    const h = sessionHealth(session([{ name: 'VtexIdclientAutCookie', expires: -1 }]), NOW);
    assert.equal(h.status, 'unknown_expiry');
    // Usable, but only because the live check runs before anything is spent.
    assert.equal(isUsable(h), true);
    assert.match(h.message, /checked against the store/);
  });

  it('does not blow up on a corrupt savedAt', () => {
    const s = session([{ name: 'VtexIdclientAutCookie', expires: sec(NOW) + 7200 }], 'not-a-date');
    const h = sessionHealth(s, NOW);
    assert.equal(h.status, 'ok');
    assert.equal(h.ageHours, undefined);
  });
});

describe('describeSpan', () => {
  it('scales the unit to the magnitude', () => {
    assert.equal(describeSpan(45), '45s');
    assert.equal(describeSpan(600), '10 min');
    assert.equal(describeSpan(7200), '2.0 h');
    assert.equal(describeSpan(86_400 * 3), '3 days');
    assert.equal(describeSpan(-5), '0s');
  });
});

describe('profileFromOrderForm', () => {
  const full = {
    clientProfileData: {
      email: 'me@example.com',
      firstName: 'Ana',
      lastName: 'Pérez',
      document: '30123456',
      documentType: 'dni',
      phone: '+5491100000000',
    },
  };

  it('reads name, email and DNI from the user own profile', () => {
    const p = profileFromOrderForm(full);
    assert.equal(p.authenticated, true);
    assert.equal(p.document, '30123456');
    assert.equal(p.documentType, 'dni');
    assert.equal(p.firstName, 'Ana');

    const guest = profileFromOrderForm({ clientProfileData: { email: 'guest@example.com' } });
    assert.equal(guest.authenticated, false, 'email alone is a guest checkout, not a login');
    assert.equal(guest.email, 'guest@example.com');
  });
});

describe('the session on disk', () => {
  let dir: string;
  after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('round-trips through the encrypted vault', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sess-'));
    const path = join(dir, 'dia.session.enc');
    const s = session([{ name: 'VtexIdclientAutCookie', value: 'eyJhbGciOi', expires: sec(NOW) + 7200 }]);

    await saveSession(path, 'correct horse battery', s);
    const back = await readSession(path, 'correct horse battery');
    assert.deepEqual(back, s);
  });

  it('never writes a cookie value in the clear', async () => {
    const path = join(dir, 'clear.enc');
    await saveSession(path, 'correct horse battery', session([
      { name: 'VtexIdclientAutCookie', value: 'SUPERSECRETCOOKIEVALUE' },
    ]));
    const raw = await readFile(path, 'utf8');
    assert.ok(!raw.includes('SUPERSECRETCOOKIEVALUE'), 'session cookie leaked to disk');
    assert.ok(!raw.includes('VtexIdclientAutCookie'));
  });

  it('fails closed on the wrong passphrase', async () => {
    const path = join(dir, 'wrong.enc');
    await saveSession(path, 'correct horse battery', session([{ name: 'VtexIdclientAutCookie' }]));
    await assert.rejects(readSession(path, 'wrong passphrase entirely'));
  });
});
