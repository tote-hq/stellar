import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readJob, startJob } from '../checkout/sandbox.ts';
import { checkoutMode } from '../checkout/mode.ts';

const ITEMS = [{ name: 'Leche', quantity: 1, sku: '1' }];
const OFF = { mock: false, mockFail: false };
const NO_SANDBOX = {} as unknown as NodeJS.ProcessEnv;
const WITH_SANDBOX = { SANDBOX_URL: 'https://sandbox.invalid' } as unknown as NodeJS.ProcessEnv;

/** A job id whose clock started `secs` ago, so the stateless mock is past its last phase. */
function aged(jobId: string, secs: number): string {
  const [m, flag, , n] = jobId.split('-');
  return `${m}-${flag}-${Date.now() - secs * 1000}-${n}`;
}

describe('which run a checkout gets', () => {
  it('an admitted manual checkout pays for real', () => {
    assert.equal(checkoutMode({ mock: false, manual: true }), 'live');
  });

  it('anyone else gets the demo, and mock wins over manual', () => {
    assert.equal(checkoutMode({ mock: false, manual: false }), 'demo');
    assert.equal(checkoutMode({ mock: true, manual: true }), 'mock');
    assert.equal(checkoutMode({ mock: true, manual: false }), 'mock');
  });
});

describe('the demo run', () => {
  it('never reaches the real sandbox, even when one is configured', async () => {
    const id = await startJob('o', ITEMS, undefined, undefined, OFF, WITH_SANDBOX, { demo: true });
    assert.match(id, /^mock-h-/);
  });

  it('stops at payment without paying, so the order refunds', async () => {
    const id = await startJob('o', ITEMS, undefined, undefined, OFF, NO_SANDBOX, { demo: true });
    const job = await readJob(aged(id, 30));
    assert.equal(job.status, 'done');
    assert.equal(job.phase, 'payment');
    assert.equal(job.result?.reached_payment, true);
    assert.equal(job.result?.payment, 'not_attempted');
    assert.equal(job.result?.store_order_id, null);
  });
});
