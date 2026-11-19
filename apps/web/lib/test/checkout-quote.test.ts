import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickBeloUsdc, quoteRate } from '../checkout/rate.ts';
import { pickSla, shippingFrom } from '../checkout/shipping.ts';

// The dolarapi response the rate was specified against.
const DOLARAPI = [
  { exchange: 'belo', moneda: 'ARS', monedaBase: 'USD', criptomoneda: null, criptomonedaBase: 'USDT', compra: 1581, venta: 1561 },
  { exchange: 'belo', moneda: 'ARS', monedaBase: 'USD', criptomoneda: null, criptomonedaBase: 'USDC', compra: 1584.179019465, venta: 1559.43782925 },
  { exchange: 'belo', moneda: 'ARS', monedaBase: 'USD', criptomoneda: null, criptomonedaBase: 'USD_AR', compra: 1559.17, venta: 1485.25 },
  { exchange: 'dolarapp', moneda: 'ARS', monedaBase: 'USD', criptomoneda: null, criptomonedaBase: 'USDC', compra: 1563.35, venta: 1560.9375 },
];

describe('the quote rate', () => {
  it('is belo USDC compra, not USDT and not another exchange', () => {
    assert.equal(pickBeloUsdc(DOLARAPI), 1584.179019465);
  });

  it('refuses a feed without it, or with an absurd number', () => {
    assert.equal(pickBeloUsdc(DOLARAPI.filter((r) => r.exchange !== 'belo')), undefined);
    assert.equal(pickBeloUsdc([{ exchange: 'belo', criptomonedaBase: 'USDC', compra: 1 }]), undefined);
    assert.equal(pickBeloUsdc({ error: 'nope' }), undefined);
  });

  it('does not fall back to another source when the feed is down', async () => {
    const down = (async () => new Response('', { status: 502 })) as typeof fetch;
    await assert.rejects(quoteRate({ fetchImpl: down, now: 1 }));
  });

  it('honours ARS_PER_USD as an explicit override', async () => {
    const r = await quoteRate({ override: 1500 });
    assert.equal(r.arsPerUsd, 1500);
    assert.equal(r.source, 'ARS_PER_USD');
  });
});

describe('the envío quote', () => {
  const windowed = {
    id: 'Envío a Domicilio',
    deliveryChannel: 'delivery',
    price: 499900,
    availableDeliveryWindows: [
      { startDateUtc: '2026-10-14T12:00:00+00:00', price: 0 },
      { startDateUtc: '2026-10-13T12:00:00+00:00', price: 0 },
    ],
  };

  it('picks the earliest window, the cheapest unscheduled delivery, and never store pickup', () => {
    const pick = pickSla([windowed, { id: 'Express', deliveryChannel: 'delivery', price: 100 }]);
    assert.equal(pick?.sla.id, 'Envío a Domicilio');
    assert.equal(pickSla([{ id: 'Retiro', deliveryChannel: 'pickup-in-point', price: 0 }]), undefined);
    const fallback = pickSla([
      { id: 'A', price: 900 },
      { id: 'B', price: 500 },
    ]);
    assert.equal(fallback?.sla.id, 'B');
  });

  it('sums every item, and fails when one cannot be delivered', () => {
    assert.deepEqual(shippingFrom([{ itemIndex: 0, slas: [windowed] }]), { centavos: 499900, sla: 'Envío a Domicilio' });
    assert.equal(shippingFrom([{ itemIndex: 0, slas: [windowed] }, { itemIndex: 1, slas: [] }]), undefined);
  });
});
