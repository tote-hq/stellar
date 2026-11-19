import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { identifyWallet, initPostHog, type PostHogClient } from '../posthog.ts';
import { ensureUserCookie, forgetUserCookie } from '../session-login.ts';

const ADDRESS = 'GA' + 'B'.repeat(54);

/** A wallet that signs everything with a fixed stand-in signature. */
const sign = async (_message: string) => 'c2lnbmVk';
/** A wallet that will not sign: a passkey smart wallet, or a declined prompt. */
const refuse = async (_message: string) => null;

/** Swap in a fetch that counts calls and resolves when we say so. */
function stubFetch(reply: () => Promise<Response>) {
  const calls: string[] = [];
  (globalThis as { fetch: unknown }).fetch = (input: unknown, init?: { body?: string }) => {
    calls.push(String(init?.body ?? ''));
    return reply();
  };
  return calls;
}

const ok = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }));
const denied = () => Promise.resolve(new Response('{"error":"invalid_address"}', { status: 400 }));

beforeEach(forgetUserCookie);

describe('ensureUserCookie', () => {
  it('mints one login proof and reuses it for a racing or later caller', async () => {
    const calls = stubFetch(ok);
    const [a, b] = await Promise.all([ensureUserCookie(ADDRESS, sign), ensureUserCookie(ADDRESS, sign)]);
    assert.equal(calls.length, 1);
    assert.deepEqual([a, b], [true, true]);
    assert.match(calls[0]!, /GAB/);
    const body = JSON.parse(calls[0]!) as { address: string; proof?: { message: string; signature: string } };
    assert.equal(body.address, ADDRESS);
    assert.equal(body.proof?.signature, 'c2lnbmVk');
    assert.match(body.proof?.message ?? '', new RegExp(`^Changuito: iniciar sesión con ${ADDRESS} \\(`));
    await ensureUserCookie(ADDRESS, sign);
    assert.equal(calls.length, 1);
  });

  it('does not call the server when the wallet will not sign', async () => {
    const calls = stubFetch(ok);
    assert.equal(await ensureUserCookie(ADDRESS, refuse), false);
    assert.equal(calls.length, 0);
  });

  it('does not remember a failure — the next caller gets a real attempt', async () => {
    const calls = stubFetch(denied);
    assert.equal(await ensureUserCookie(ADDRESS, sign), false);
    assert.equal(await ensureUserCookie(ADDRESS, sign), false);
    assert.equal(calls.length, 2);
  });

  it('reports false rather than throwing when the network is gone', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    assert.equal(await ensureUserCookie(ADDRESS, sign), false);
  });

  it('mints again for another address, after logout, or when forced', async () => {
    const calls = stubFetch(ok);
    await ensureUserCookie(ADDRESS, sign);
    await ensureUserCookie('GC' + 'D'.repeat(54), sign);
    assert.equal(calls.length, 2);

    forgetUserCookie();
    const afterLogout = stubFetch(ok);
    await ensureUserCookie(ADDRESS, sign);
    forgetUserCookie();
    await ensureUserCookie(ADDRESS, sign);
    assert.equal(afterLogout.length, 2);

    forgetUserCookie();
    const forced = stubFetch(ok);
    await ensureUserCookie(ADDRESS, sign);
    assert.equal(await ensureUserCookie(ADDRESS, sign, { force: true }), true);
    assert.equal(forced.length, 2);

    forgetUserCookie();
    const inflight = stubFetch(ok);
    const [a, b] = await Promise.all([
      ensureUserCookie(ADDRESS, sign),
      ensureUserCookie(ADDRESS, sign, { force: true }),
    ]);
    assert.deepEqual([a, b], [true, true]);
    assert.equal(inflight.length, 1);
  });

  it('identifies the wallet by analyticsId and never by the address', async () => {
    const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const seen: string[] = [];
    const client: PostHogClient = {
      init() {},
      opt_in_capturing() {},
      opt_out_capturing() {},
      startSessionRecording() {},
      identify(id) {
        seen.push(id);
      },
      reset() {},
      capture() {},
    };
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    const host = globalThis as { document?: { cookie: string } };
    const previousDocument = host.document;
    host.document = { cookie: 'chg_consent=granted' };
    initPostHog(client);
    try {
      const analyticsId = '11111111-1111-4111-8111-111111111111';
      stubFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, address: ADDRESS, analyticsId }), { status: 200 }),
        ),
      );
      assert.equal(await ensureUserCookie(ADDRESS, sign), true);
      assert.deepEqual(seen, [analyticsId]);
      identifyWallet(ADDRESS);
      assert.deepEqual(seen, [analyticsId]);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
      else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
      if (previousDocument === undefined) delete host.document;
      else host.document = previousDocument;
    }
  });
});
