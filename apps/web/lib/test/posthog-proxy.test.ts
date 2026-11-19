import assert from 'node:assert/strict';
import { test } from 'node:test';

import { POSTHOG_PROXY_PATH } from '../posthog-path.ts';
import { proxyPostHog } from '../posthog-proxy.ts';

test('forwards ingest and static assets and strips cookies both ways', async () => {
  assert.equal(POSTHOG_PROXY_PATH, '/s7k');
  const seen: { url: string; cookie: string | null; host: string | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(input), cookie: headers.get('cookie'), host: headers.get('host') });
    return new Response('ok', { headers: { 'set-cookie': 'ph=1; Path=/', 'x-test': '1' } });
  };

  const ingest = new Request(`https://app.changuito.me${POSTHOG_PROXY_PATH}/e/?ip=0`, {
    headers: { cookie: 'chg_user=secret; chg_consent=granted' },
  });
  const res = await proxyPostHog(ingest, fetchImpl);
  assert.ok(res);
  assert.equal(seen[0]?.url, 'https://us.i.posthog.com/e/?ip=0');
  assert.equal(seen[0]?.cookie, null);
  assert.equal(seen[0]?.host, 'us.i.posthog.com');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.equal(res.headers.get('x-test'), '1');

  const asset = new Request(`https://app.changuito.me${POSTHOG_PROXY_PATH}/static/recorder.js`);
  const assetRes = await proxyPostHog(asset, fetchImpl);
  assert.ok(assetRes);
  assert.equal(seen[1]?.url, 'https://us-assets.i.posthog.com/static/recorder.js');
  assert.equal(seen[1]?.host, 'us-assets.i.posthog.com');
  assert.equal(assetRes.headers.get('set-cookie'), null);
});

test('leaves the rest of the app alone', () => {
  assert.equal(proxyPostHog(new Request('https://app.changuito.me/api/chat')), null);
  assert.equal(proxyPostHog(new Request('https://app.changuito.me/s7kx')), null);
});
