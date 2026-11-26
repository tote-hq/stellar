import assert from 'node:assert/strict';
import { mock, describe, it } from 'node:test';

import { cotoRealJobBody, readCotoViewer, sandboxOrigin } from '../checkout/sandbox.ts';

describe('coto real sandbox body', () => {
  it('sends the delivery address and no Día login or card', () => {
    const body = cotoRealJobBody(
      'a'.repeat(64),
      [{ name: 'Leche', quantity: 1, sku: 'sku-1' }],
      { fulfillment: 'home', city: 'CABA', delivery: { postalCode: '1425', street: 'Calle', number: '10', city: 'CABA' } },
    );
    assert.equal(body.mode, 'coto_real');
    assert.equal(body.delivery?.street, 'Calle');
    const json = JSON.stringify(body);
    assert.equal(json.includes('password'), false);
    assert.equal(json.includes('pan'), false);
    assert.equal(json.includes('shopper'), false);
    assert.equal(json.includes('card'), false);
  });

  it('never carries a card in either fulfillment', () => {
    const sentinel = 'SENTINEL-CARD-VALUE';
    const home = cotoRealJobBody('a'.repeat(64), [{ name: 'Leche', quantity: 1, sku: 'sku-1' }], {
      fulfillment: 'home',
      city: 'CABA',
      delivery: { postalCode: '1425', street: 'Calle', number: '10', city: 'CABA' },
    });
    const pickup = cotoRealJobBody('b'.repeat(64), [{ name: 'Leche', quantity: 1, sku: 'sku-1' }], {
      fulfillment: 'pickup',
      city: 'CABA',
    });
    for (const body of [home, pickup]) {
      assert.equal('card' in body, false);
      const json = JSON.stringify(body);
      assert.equal(json.includes('card'), false);
      assert.equal(json.includes('pan'), false);
      assert.equal(json.includes(sentinel), false);
    }
    assert.equal(pickup.city, 'CABA');
    assert.equal(pickup.delivery, undefined);
    assert.equal(JSON.stringify(pickup).includes('street'), false);
  });
});

describe('readCotoViewer', () => {
  const env = { NODE_ENV: 'test' as const, SANDBOX_URL: 'https://sandbox.example/sandbox', SANDBOX_TOKEN: 'tok' };

  it('reads the url, the ticket and the job id from the sandbox origin', async () => {
    assert.equal(sandboxOrigin(env), 'https://sandbox.example');
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({
        url: 'https://sandbox.example/viewer/?job=job1&part=screen',
        ticket: 'a'.repeat(43),
        job_id: 'job1',
      }),
    );
    try {
      const viewer = await readCotoViewer('job1', env);
      assert.deepEqual(viewer, {
        url: 'https://sandbox.example/viewer/?job=job1&part=screen',
        ticket: 'a'.repeat(43),
        jobId: 'job1',
      });
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('rejects a viewer URL on a foreign origin', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({
        url: 'https://evil.example/viewer/?job=job1',
        ticket: 'a'.repeat(43),
        job_id: 'job1',
      }),
    );
    try {
      assert.equal(await readCotoViewer('job1', env), null);
    } finally {
      fetchMock.mock.restore();
    }
  });
});
