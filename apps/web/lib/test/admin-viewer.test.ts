import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { decideAdmin } from '../admin/gate.ts';
import { adminViewerBody, viewerConnectMessage, viewerReadyFromFrame } from '../admin/viewer-connect.ts';
import config from '../../next.config.ts';

describe('admin Coto viewer', () => {
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
});
