import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sandboxMode, startJob } from '../checkout/sandbox.ts';

type Env = Parameters<typeof sandboxMode>[1];
const URL_SET = { SANDBOX_URL: 'https://sandbox.example' } as unknown as Env;
const NO_URL = {} as Env;
const OFF = { mock: false, mockFail: false };
const SHOPPER = { email: 'a@b.com', password: 'x', dni: '30123456' };
const ITEMS = [{ name: 'Fideos', quantity: 2, sku: '61450' }];
const ORDER = 'o'.repeat(64);

describe('sandbox mode comes from the config flags, not the environment', () => {
  it('sandbox_mock forces the mock even with SANDBOX_URL set', () => {
    assert.equal(sandboxMode({ mock: true, mockFail: false }, URL_SET), 'mock');
  });

  it('without the flag, SANDBOX_URL means remote and no URL means off', () => {
    assert.equal(sandboxMode(OFF, URL_SET), 'remote');
    assert.equal(sandboxMode(OFF, NO_URL), 'off');
  });

  it('refuses to start a job when checkout is off', async () => {
    await assert.rejects(startJob(ORDER, ITEMS, SHOPPER, undefined, OFF, NO_URL));
  });
});
