import assert from 'node:assert/strict';
import { after, describe, it, mock } from 'node:test';

mock.module('@changuito/mcp/compare', {
  namedExports: {
    cotoPricer() {
      return { async getProduct() { return null; } };
    },
    async priceCotoCart(cartId: string, lines: { id: string; quantity: number }[]) {
      return {
        retailer: 'coto',
        cartId,
        messages: [],
        total: { centavos: 247400, display: '$2474,00' },
        lines: lines.map((line, index) => ({
          index,
          skuId: line.id,
          name: 'Leche',
          quantity: line.quantity,
          sellerId: 'coto',
          unitPrice: { centavos: 247400, display: '$2474,00' },
          lineTotal: { centavos: 247400 * line.quantity, display: '$2474,00' },
          available: true,
        })),
      };
    },
  },
});

const ADDRESS = 'GBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYER';
const SID = '00000000-0000-4000-8000-0000000000bb';
const POSTAL = '1425';
const STREET = 'Calle Privada';
const NUMBER = '742';

const cart = {
  retailer: 'coto' as const,
  cartId: 'coto-real-1',
  messages: [],
  total: { centavos: 247400, display: '$2474,00' },
  lines: [
    {
      index: 0,
      skuId: 'coto-real',
      name: 'Leche',
      quantity: 1,
      sellerId: 'coto',
      unitPrice: { centavos: 247400, display: '$2474,00' },
      lineTotal: { centavos: 247400, display: '$2474,00' },
      available: true,
    },
  ],
};

function snapshotTurn() {
  return {
    messages: [],
    cache: {
      products: new Map(),
      cotoRealDia: {
        buyer: ADDRESS,
        pairs: [{ cotoId: 'coto-real', diaSkuId: 'd1', diaCentavos: 247500, confidence: 'ean' as const }],
      },
    },
  };
}

describe('coto-real quote gates', () => {
  const logs: unknown[][] = [];
  const original = console.warn;

  after(async () => {
    console.warn = original;
    const { __setCotoRealTurnReaderForTests } = await import('../checkout/coto-real-http.ts');
    const { __setCotoAdmitForTests } = await import('../checkout/coto-admit.ts');
    __setCotoRealTurnReaderForTests(null);
    __setCotoAdmitForTests({ flags: null, present: null });
  });

  async function post(body: Record<string, unknown>, turn: ReturnType<typeof snapshotTurn> | undefined) {
    const { postCotoRealQuote, __setCotoRealTurnReaderForTests } = await import('../checkout/coto-real-http.ts');
    const { __setCotoAdmitForTests } = await import('../checkout/coto-admit.ts');
    process.env.COTO_REAL_ENABLED = '1';
    __setCotoAdmitForTests({ flags: async () => true, present: async () => false });
    __setCotoRealTurnReaderForTests(async () => turn as never);
    logs.length = 0;
    console.warn = (...args: unknown[]) => {
      logs.push(args);
    };
    return postCotoRealQuote(ADDRESS, cart, { sessionId: SID, ...body });
  }

  function joined(): string {
    return logs.map((args) => args.map((part) => String(part)).join(' ')).join('\n');
  }

  function leaked(text: string): void {
    assert.equal(text.includes(POSTAL), false);
    assert.equal(text.includes(STREET), false);
    assert.equal(text.includes(NUMBER), false);
  }

  it('logs snapshot and nothing else when the compare lock is missing', async () => {
    const res = await post({}, undefined);
    assert.equal(res.status, 400);
    assert.deepEqual(logs, [['coto-pay gate=snapshot']]);
    leaked(joined());
  });

  it('logs postal when the code is missing or invalid', async () => {
    const missing = await post({ city: 'CABA', street: STREET, number: NUMBER }, snapshotTurn());
    assert.equal(missing.status, 400);
    assert.deepEqual(logs, [['coto-pay gate=postal']]);
    leaked(joined());

    const invalid = await post({ postalCode: 'no-es-cp', city: 'CABA', street: STREET, number: NUMBER }, snapshotTurn());
    assert.equal(invalid.status, 400);
    assert.deepEqual(logs, [['coto-pay gate=postal']]);
    leaked(joined());
  });

  it('logs city without the postal code', async () => {
    const res = await post({ postalCode: POSTAL, street: STREET, number: NUMBER }, snapshotTurn());
    assert.equal(res.status, 400);
    assert.deepEqual(logs, [['coto-pay gate=city']]);
    leaked(joined());
  });

  it('logs street without the street or the number', async () => {
    const res = await post(
      { postalCode: POSTAL, city: 'CABA', fulfillment: 'home', street: STREET },
      snapshotTurn(),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(logs, [['coto-pay gate=street']]);
    leaked(joined());
  });

  it('logs card when the shared card is missing', async () => {
    const res = await post({ postalCode: POSTAL, city: 'CABA', fulfillment: 'pickup' }, snapshotTurn());
    assert.equal(res.status, 409);
    assert.deepEqual(logs, [['coto-pay gate=card']]);
    leaked(joined());
  });
});
