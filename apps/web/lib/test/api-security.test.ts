import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';

/**
 * Money routes with no Turnstile cookie.
 *
 * Settle and the faucet already have their own gate tests. Quote and network
 * are called as handlers. Balance is pinned on the source: `requireHuman(`
 * is present and comes before `accountBalances(`.
 */

// @types/node marks NODE_ENV readonly. The other route tests write through this cast.
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';

type Handler = (req: Request) => Promise<Response>;

const anon = (url: string) => new Request(url);

describe('Stellar money APIs refuse a stranger', () => {
  let quote: Handler;
  let network: Handler;

  before(async () => {
    quote = (await import('../../app/api/quote/route.ts')).GET;
    network = (await import('../../app/api/network/route.ts')).GET;
  });

  it('RULE: quote and network stop at the human gate', async () => {
    const cases: Array<[string, Handler, Request]> = [
      ['GET /api/quote', quote, anon('https://ste.changuito.me/api/quote?centavos=1000')],
      ['GET /api/network', network, anon('https://ste.changuito.me/api/network?address=G' + 'A'.repeat(55))],
    ];
    for (const [name, handler, req] of cases) {
      const res = await handler(req);
      assert.equal(res.status, 403, name);
      assert.doesNotMatch(await res.text(), /"xlm"|"usdc"|"usdCents"/, name);
    }
  });

  it('RULE: the balance route asks for a human before it reads an account', () => {
    const rel = 'app/api/balance/route.ts';
    const src = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
    const human = src.indexOf('requireHuman(');
    const spend = src.indexOf('accountBalances(');
    assert.ok(human > 0, `${rel}: requireHuman( is present`);
    assert.ok(spend > 0, `${rel}: accountBalances( is present`);
    assert.ok(human < spend, `${rel}: human gate must precede accountBalances`);
  });

});
