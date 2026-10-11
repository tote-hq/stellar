import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';

/**
 * Money routes with no Turnstile cookie.
 *
 * Settle and the faucet already have their own gate tests. The card routes
 * import generated contract bindings, which strip-types cannot load, so those
 * are pinned on the source: `requireHuman` runs before any card client. Quote,
 * balance and network are called as handlers.
 */

process.env.NODE_ENV = 'production';
process.env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';

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

  it('RULE: card routes ask for a human before they touch a card', () => {
    const files = [
      'app/api/balance/route.ts',
      'app/api/card/route.ts',
      'app/api/card/mine/route.ts',
      'app/api/card/3ds/route.ts',
      'app/api/card/terminate/route.ts',
      'app/api/card/retire/route.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
      const human = src.indexOf('requireHuman(');
      const spend = src.search(/issueCard\(|cardClient\(|heldCard\(|canIssueCard\(|accountBalances\(/);
      assert.ok(human > 0, rel);
      if (spend > 0) assert.ok(human < spend, `${rel}: human gate must precede the spend`);
    }
  });
});
