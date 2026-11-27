import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, mock } from 'node:test';

import { decideAdmin } from '../admin/gate.ts';
import { adminViewerBody, viewerConnectMessage, viewerReadyFromFrame } from '../admin/viewer-connect.ts';
import { readCotoViewer } from '../checkout/sandbox.ts';
import type { CheckoutRecord } from '../checkout/store.ts';
import config from '../../next.config.ts';

describe('admin Coto viewer', { concurrency: false }, () => {
  it('returns 404 to a shopper on the viewer route', async () => {
    const shopper = await decideAdmin({
      url: 'https://app.changuito.me/api/admin/orders/abc/viewer',
      method: 'GET',
      headers: { get: () => null },
    });
    assert.equal(shopper?.status, 404);
  });

  it('returns the ticket with the url, and url null when the screen is closed', () => {
    const ticket = 'a'.repeat(43);
    assert.deepEqual(
      adminViewerBody({ url: 'https://sandbox.example/viewer/?job=1', ticket, jobId: 'job1' }),
      { url: 'https://sandbox.example/viewer/?job=1', ticket, jobId: 'job1' },
    );
    assert.deepEqual(adminViewerBody(null), { url: null });
    const route = readFileSync(new URL('../../app/api/admin/orders/[id]/viewer/route.ts', import.meta.url), 'utf8');
    assert.match(route, /adminViewerBody/);
    assert.match(route, /private, no-store/);
    assert.doesNotMatch(route, /checkoutStore\(\)\.set/);
  });

  it('posts the ticket to the viewer origin and never to a wildcard', () => {
    const url = 'https://sandbox.example/viewer/?job=abc&part=screen';
    const sent = viewerConnectMessage(url, 'abc', 'ticket-value');
    assert.equal(sent.origin, 'https://sandbox.example');
    assert.equal(sent.origin.includes('*'), false);
    assert.deepEqual(sent.message, {
      type: 'changuito-viewer-connect',
      jobId: 'abc',
      ticket: 'ticket-value',
      lang: 'es',
    });
    const frame = { contentWindow: { name: 'frame' } };
    const ready = {
      source: frame.contentWindow,
      origin: 'https://sandbox.example',
      data: { type: 'changuito-viewer-ready' },
    };
    assert.equal(viewerReadyFromFrame(ready, frame.contentWindow, url), true);
    assert.equal(viewerReadyFromFrame({ ...ready, origin: 'https://evil.example' }, frame.contentWindow, url), false);
    assert.equal(viewerReadyFromFrame({ ...ready, source: {} }, frame.contentWindow, url), false);
    assert.equal(viewerReadyFromFrame(ready, null, url), false);
  });

  it('mounts an iframe and does not open a new tab', () => {
    const page = readFileSync(new URL('../../app/admin-portal/orders/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /data-testid="admin-coto-viewer"/);
    assert.match(page, /referrerPolicy="origin"/);
    assert.match(page, /sandbox="allow-scripts allow-same-origin"/);
    assert.match(page, /viewerConnectMessage/);
    assert.match(page, /La pantalla solo se abre mientras la firma sigue adentro de 60 segundos/);
    assert.match(page, /role="status"/);
    assert.match(page, /data-testid="admin-viewer-status"/);
    assert.match(page, /La pantalla no respondió\. Probá de nuevo\./);
    assert.match(page, /La pantalla ya no está abierta\./);
    assert.match(page, /AbortSignal\.timeout/);
    assert.doesNotMatch(page, /target="_blank"/);
    assert.doesNotMatch(page, /window\.open/);
    assert.doesNotMatch(page, /'\*'/);
  });

  it('sends one CSP on the admin host, from middleware, with the shopper policy unchanged', async () => {
    if (!config.headers) throw new Error('next.config headers');
    const rules = await config.headers();
    const applies = (rule: { missing?: { type: string; value?: string }[] }, host: string) =>
      !(rule.missing ?? []).some((cond) => cond.type === 'host' && cond.value === host);
    const pageRules = rules.filter((rule) => rule.source === '/:path*');
    const csp = (host: string) =>
      pageRules
        .filter((rule) => applies(rule, host))
        .flatMap((rule) => rule.headers.filter((header) => header.key === 'Content-Security-Policy'));
    assert.equal(csp('admin.changuito.me').length, 0);
    assert.equal(csp('admin.localhost').length, 0);
    assert.equal(csp('app.changuito.me').length, 1);
    assert.equal(csp('app.changuito.me')[0]?.value.includes('https://sandbox.example'), false);
    const middleware = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    assert.equal(middleware.split("headers.set('Content-Security-Policy'").length - 1, 1);
    assert.match(middleware, /withAdminCsp\(NextResponse\.rewrite/);
  });

  it('returns null when the sandbox does not answer before the deadline', async () => {
    const env = { NODE_ENV: 'test' as const, SANDBOX_URL: 'https://sandbox.example/sandbox', SANDBOX_TOKEN: 'tok' };
    const fetchMock = mock.method(globalThis, 'fetch', (_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error('missing deadline'));
      if (signal.aborted) return Promise.reject(signal.reason);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const started = Date.now();
    // AbortSignal.timeout does not keep the event loop alive on its own.
    const keep = setTimeout(() => {}, 1_000);
    try {
      assert.equal(await readCotoViewer('job-slow', env, 40), null);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 1_000);
      assert.ok(elapsed >= 30);
    } finally {
      clearTimeout(keep);
      fetchMock.mock.restore();
    }
  });

  it('answers unreachable when the screen cannot be read, and a url when it can', async () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      SANDBOX_URL: process.env.SANDBOX_URL,
      SANDBOX_TOKEN: process.env.SANDBOX_TOKEN,
      ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    };
    delete process.env.DATABASE_URL;
    process.env.SANDBOX_URL = 'https://sandbox.example/sandbox';
    process.env.SANDBOX_TOKEN = 'tok';
    process.env.ADMIN_SESSION_SECRET = 'test-only-admin-secret';
    const { __setAdminStoreForTests } = await import('../admin/store.ts');
    const { signAdminCookie } = await import('../admin/cookie.ts');
    const { checkoutStore } = await import('../checkout/store.ts');
    const { GET } = await import('../../app/api/admin/orders/[id]/viewer/route.ts');
    const id = 'ab'.repeat(32);
    const ticket = 'a'.repeat(43);
    const liveUrl = 'https://sandbox.example/viewer/?job=job1&part=screen';
    let mode: 'throw' | 'missing' | 'closed' | 'live' = 'throw';
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      if (mode === 'throw') throw new Error('network');
      if (mode === 'missing') return Response.json({ url: 12 });
      if (mode === 'closed') return new Response('closed', { status: 404 });
      return Response.json({ url: liveUrl, ticket, job_id: 'job1' });
    });
    try {
      __setAdminStoreForTests({
        async sessionByHash() {
          return { adminId: 'op' };
        },
      } as never);
      const token = await signAdminCookie(
        { exp: Date.now() + 60_000, csrf: 'csrf-test', jti: 'jti-viewer' },
        'test-only-admin-secret',
      );
      assert.ok(token);
      const rec: CheckoutRecord = {
        orderId: id,
        buyer: 'GBUYER',
        amount: '1',
        amountCents: 1,
        basketHash: 'cd'.repeat(32),
        arsPerUsd: 1,
        totalDisplay: '1',
        retailer: 'coto',
        lines: [],
        handoffUrl: null,
        createdAt: 1,
        jobId: 'job1',
      };
      await checkoutStore().set(rec);
      const ask = () =>
        GET(new Request(`https://admin.changuito.me/api/admin/orders/${id}/viewer`, {
          headers: { cookie: `chg_admin=${token}` },
        }), { params: Promise.resolve({ id }) });

      mode = 'throw';
      assert.deepEqual(await (await ask()).json(), { url: null, reason: 'unreachable' });
      mode = 'missing';
      assert.deepEqual(await (await ask()).json(), { url: null, reason: 'unreachable' });
      mode = 'closed';
      assert.deepEqual(await (await ask()).json(), { url: null, reason: 'closed' });
      mode = 'live';
      const body = await (await ask()).json();
      assert.equal(body.url, liveUrl);
      assert.equal(body.ticket, ticket);
      assert.equal(body.jobId, 'job1');
      assert.equal(body.reason, undefined);
    } finally {
      fetchMock.mock.restore();
      __setAdminStoreForTests(null);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
