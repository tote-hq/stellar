import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  CounterUnavailable,
  FREE_TURNS,
  FREE_TURNS_PER_HUMAN,
  FREE_TURNS_PER_IP,
  __resetTurnCounterForTests,
  requireLoginOrFreeTurn,
  takeQuota,
  type TurnCounter,
  USER_TURNS_PER_HOUR,
  guestChatVerdict,
  mintUserToken,
  verifyUserToken,
  LOGIN_REQUIRED_MESSAGE,
  loginGateBannerText,
  shouldShowLoginGate,
} from '../login-gate.ts';

describe('login-gate', () => {
  beforeEach(() => {
    __resetTurnCounterForTests();
  });

  it('mints a user token and rejects a stale, forged or v1 one', async () => {
    const secret = 'test-session-secret';
    const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const token = await mintUserToken(address, secret, 1_000_000, 60_000);
    const ok = await verifyUserToken(token, secret, 1_000_000);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.address, address);
    assert.equal((await verifyUserToken(token, secret, 1_100_000)).ok, false);
    assert.equal((await verifyUserToken(token, 'other', 1_000_000)).ok, false);
    assert.match(token, /^v2\./);
    const v1 = token.slice(3);
    assert.equal((await verifyUserToken(v1, secret, 1_000_000)).ok, false);
  });

  it('allows FREE_TURNS guest attempts then blocks', () => {
    for (let used = 0; used < FREE_TURNS; used++) {
      const v = guestChatVerdict({ loggedIn: false, sessionCount: used });
      assert.equal(v.allow, true, `turn ${used + 1} should allow`);
      assert.equal(v.turnsUsed, used + 1);
    }
    const blocked = guestChatVerdict({ loggedIn: false, sessionCount: FREE_TURNS });
    assert.equal(blocked.allow, false);
    assert.equal(blocked.reason, 'login_required');
  });

  it('shows the login banner only to an anonymous shopper after the free turns', () => {
    for (const turnsUsed of [FREE_TURNS, 99]) {
      const banner = loginGateBannerText({ isAuthenticated: true, loginRequired: true, turnsUsed });
      assert.equal(shouldShowLoginGate({ isAuthenticated: true, loginRequired: true, turnsUsed }), false);
      assert.equal(banner, null);
    }
    assert.equal(
      shouldShowLoginGate({ isAuthenticated: false, loginRequired: false, turnsUsed: FREE_TURNS }),
      true,
    );
    assert.equal(
      shouldShowLoginGate({ isAuthenticated: false, loginRequired: false, turnsUsed: FREE_TURNS - 1 }),
      false,
    );
    const banner = loginGateBannerText({
      isAuthenticated: false,
      loginRequired: true,
      turnsUsed: FREE_TURNS,
    });
    assert.equal(banner, LOGIN_REQUIRED_MESSAGE);
    assert.match(banner ?? '', /Para seguir, iniciá sesión/);
  });

  it('blocks when IP soft ceiling is hit', () => {
    const v = guestChatVerdict({
      loggedIn: false,
      sessionCount: 0,
      ipCount: FREE_TURNS_PER_IP,
    });
    assert.equal(v.allow, false);
    assert.equal(v.reason, 'ip_limit');
  });

  it('blocks a guest who rotates sessionId on the same Turnstile pass', async () => {
    const v = guestChatVerdict({ loggedIn: false, sessionCount: 0, humanCount: FREE_TURNS_PER_HUMAN });
    assert.equal(v.allow, false);
    assert.equal(v.reason, 'human_limit');

    const req = () => chat({ cookie: 'chg_human=same-pass' });
    let allowed = 0;
    for (let i = 0; i < FREE_TURNS_PER_HUMAN + 3; i++) {
      const session = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      if ((await requireLoginOrFreeTurn(req(), session, prodEnv)) === null) allowed++;
    }
    assert.equal(allowed, FREE_TURNS_PER_HUMAN);
  });
});

const failing: TurnCounter = {
  kind: 'redis',
  get: async () => {
    throw new CounterUnavailable('down');
  },
  incr: async () => {
    throw new CounterUnavailable('down');
  },
};

const UUID = '00000000-0000-4000-8000-000000000000';
const prodEnv = { NODE_ENV: 'production', CHG_SESSION_SECRET: 'sess' } as NodeJS.ProcessEnv;
const chat = (headers: Record<string, string> = {}) => new Request('https://app.changuito.me/api/chat', { method: 'POST', headers });

describe('quotas fail closed', () => {
  beforeEach(() => __resetTurnCounterForTests());

  it('refuses a turn when the counter store is down', async () => {
    __resetTurnCounterForTests(failing);
    const guest = await requireLoginOrFreeTurn(chat(), UUID, prodEnv);
    assert.equal(guest?.status, 503);
    const token = await mintUserToken('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 'sess');
    const signedIn = await requireLoginOrFreeTurn(chat({ cookie: `chg_user=${encodeURIComponent(token)}` }), UUID, prodEnv);
    assert.equal(signedIn?.status, 503);
    assert.equal(await takeQuota('k', 1, 60, failing), 'unavailable');
  });

  it('caps a signed-in wallet per hour', async () => {
    const token = await mintUserToken('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 'sess');
    const req = () => chat({ cookie: `chg_user=${encodeURIComponent(token)}` });
    for (let i = 0; i < USER_TURNS_PER_HOUR; i++) assert.equal(await requireLoginOrFreeTurn(req(), UUID, prodEnv), null);
    const res = await requireLoginOrFreeTurn(req(), UUID, prodEnv);
    assert.equal(res?.status, 429);
  });

  /**
   * The gate runs before /api/chat writes its first byte, so its wall clock is
   * the window in which a failure reads "No se envió" rather than "Se cortó
   * antes de responder". Seven serial Upstash round trips is what put a chat
   * turn past a gateway's patience with nothing sent.
   */
  it('RULE: asks its independent counters together, not one after another', async () => {
    let live = 0;
    let mostAtOnce = 0;
    const phases: number[] = [];
    const slow = <T,>(v: T): Promise<T> =>
      new Promise((resolve) => {
        live++;
        mostAtOnce = Math.max(mostAtOnce, live);
        setTimeout(() => {
          live--;
          resolve(v);
        }, 5);
      });

    const concurrent: TurnCounter = {
      kind: 'memory',
      async get() {
        phases.push(1);
        return slow(0);
      },
      async incr() {
        phases.push(2);
        return slow(1);
      },
    };
    __resetTurnCounterForTests(concurrent);

    const res = await requireLoginOrFreeTurn(
      chat({ cookie: 'chg_human=a-pass', 'cf-connecting-ip': '1.1.1.1' }),
      UUID,
      prodEnv,
    );
    assert.equal(res, null);
    assert.equal(phases.filter((p) => p === 1).length, 3);
    assert.equal(phases.filter((p) => p === 2).length, 3);
    assert.equal(mostAtOnce, 3, 'the counter calls were serialised');
    assert.deepEqual(phases, [1, 1, 1, 2, 2, 2]);
  });
});
