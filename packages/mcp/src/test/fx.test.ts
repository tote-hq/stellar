import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  DEFAULT_BUFFER,
  arsToUsdCents,
  assertSaneRate,
  clearFxCache,
  getArsPerUsd,
} from '../pay/fx.js';

/** A plausible 2026 official rate. Chosen once so the arithmetic below is readable. */
const RATE = 1450;

afterEach(() => {
  clearFxCache();
  delete process.env.ARS_PER_USD;
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('assertSaneRate — the guard on the most dangerous number here', () => {
  it('refuses a rate of 1, which would load 1450x too much onto the card', () => {
    assert.throws(() => assertSaneRate(1, 'test'), /outside the sane range/);
    assert.throws(() => assertSaneRate(1e9, 'test'), /outside the sane range/);
    for (const bad of [0, -100, NaN, Infinity]) {
      assert.throws(() => assertSaneRate(bad, 'test'), /ARS rate|sane range/, String(bad));
    }
    assert.throws(() => arsToUsdCents(1_000_000, 1), /outside the sane range/);
  });
});

describe('arsToUsdCents', () => {
  it('converts with the default buffer', () => {
    // 18430.50 ARS / 1450 = 12.7107 USD; x1.15 = 14.617 -> ceil -> 1462 cents
    assert.equal(arsToUsdCents(1_843_050, RATE), 1462);
  });

  it('always rounds UP, so the card is never a cent short at the till', () => {
    // Any amount that lands mid-cent must go up, never down.
    const cents = arsToUsdCents(100, RATE, 0); // 1 peso, a fraction of a cent
    assert.equal(cents, 1);
  });
});

describe('getArsPerUsd', () => {
  it('still range-checks an override', async () => {
    await assert.rejects(getArsPerUsd({ override: 2 }), /outside the sane range/);
  });

  it('fails loudly on a bad feed rather than guessing a rate', async () => {
    const httpFail = (async () => jsonResponse({}, 503)) as unknown as typeof fetch;
    await assert.rejects(() => getArsPerUsd({ fetchImpl: httpFail }), /HTTP 503/);
    clearFxCache();
    const noArs = (async () => jsonResponse({ rates: { EUR: 0.9 } })) as unknown as typeof fetch;
    await assert.rejects(() => getArsPerUsd({ fetchImpl: noArs }), /did not include an ARS rate/);
  });

  it('does not cache a rejected rate', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ rates: { ARS: calls === 1 ? 1 : RATE } });
    }) as unknown as typeof fetch;

    await assert.rejects(() => getArsPerUsd({ fetchImpl }), /outside the sane range/);
    const ok = await getArsPerUsd({ fetchImpl });
    assert.equal(ok.arsPerUsd, RATE);
  });
});

describe('DEFAULT_BUFFER', () => {
  it('is 15%, and the plan says so', () => {
    assert.equal(DEFAULT_BUFFER, 0.15);
  });
});
