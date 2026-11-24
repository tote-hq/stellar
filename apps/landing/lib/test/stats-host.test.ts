import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteStatsHost } from '../stats/host.ts';

function get(url: string, host?: string): Request {
  const headers = host ? { host } : undefined;
  return new Request(url, { headers });
}

test('stats host root is served as /stats and keeps the query', () => {
  const next = rewriteStatsHost(get('https://stats.changuito.me/?range=7d', 'stats.changuito.me'));
  const url = new URL(next.url);
  assert.equal(url.pathname, '/stats');
  assert.equal(url.search, '?range=7d');
  assert.equal(next.headers.get('host'), 'stats.changuito.me');
});

test('a port on the Host header still selects the stats host', () => {
  const next = rewriteStatsHost(get('http://127.0.0.1:3125/', 'STATS.changuito.me:3125'));
  assert.equal(new URL(next.url).pathname, '/stats');
});

test('other paths on the stats host are left alone', () => {
  const next = rewriteStatsHost(get('https://stats.changuito.me/stats', 'stats.changuito.me'));
  assert.equal(next.url, 'https://stats.changuito.me/stats');
});

test('www and the workers.dev host keep the marketing root', () => {
  for (const host of ['www.changuito.me', 'changuito.me', 'changuito-landing.changuito.workers.dev']) {
    const next = rewriteStatsHost(get(`https://${host}/`, host));
    assert.equal(new URL(next.url).pathname, '/', host);
  }
});
