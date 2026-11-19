import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import type { Cart, CartLine } from '@changuito/mcp/types';

import {
  basketHash,
  canonicalBasket,
  canonicalReceipt,
  receiptHash,
  DEFAULT_TIMEOUT_SECS,
  fromHex,
  MAX_TIMEOUT_SECS,
  MIN_TIMEOUT_SECS,
  newOrderId,
  openArgs,
  toBase64,
  toHex,
} from '../order.ts';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  index: 0,
  skuId: '12345',
  name: 'Leche descremada 1L',
  quantity: 2,
  sellerId: '1',
  unitPrice: { centavos: 150_000, display: '$1.500,00' },
  lineTotal: { centavos: 300_000, display: '$3.000,00' },
  available: true,
  ...over,
});

const cart = (over: Partial<Cart> = {}): Cart => ({
  retailer: 'dia',
  cartId: 'abc-123',
  lines: [line()],
  total: { centavos: 300_000, display: '$3.000,00' },
  messages: [],
  ...over,
});

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe('hex and base64', () => {
  it('round-trips through hex', () => {
    const id = newOrderId();
    assert.deepEqual(fromHex(toHex(id)), id);
  });
});

describe('newOrderId', () => {
  it('is 32 bytes and is not derived from anything', () => {
    assert.equal(newOrderId().length, 32);
    // If ids were a hash of the basket, a user retrying a payment that failed
    // in their wallet would be rejected for OrderExists.
    assert.notEqual(toHex(newOrderId()), toHex(newOrderId()));
  });
});

describe('canonicalBasket', () => {
  it('is stable across line order and ignores store messages', () => {
    const a = cart({ lines: [line({ index: 0 }), line({ index: 1, skuId: '999' })] });
    const b = cart({ lines: [line({ index: 1, skuId: '999' }), line({ index: 0 })] });
    assert.equal(canonicalBasket(a), canonicalBasket(b));
    assert.equal(canonicalBasket(cart()), canonicalBasket(cart({ messages: ['Promo 2x1'] })));
  });
});

describe('basketHash', () => {
  it('RULE: changing anything the user was shown changes the hash', async () => {
    const a = await basketHash(cart());
    const b = await basketHash(cart());
    assert.equal(a.length, 32);
    assert.deepEqual(a, b);

    const base = toHex(a);
    const variants: Record<string, Cart> = {
      quantity: cart({ lines: [line({ quantity: 3 })] }),
      sku: cart({ lines: [line({ skuId: '54321' })] }),
      'line price': cart({ lines: [line({ lineTotal: { centavos: 400_000, display: '$4.000,00' } })] }),
      total: cart({ total: { centavos: 999_999, display: '$9.999,99' } }),
      availability: cart({ lines: [line({ available: false })] }),
      retailer: cart({ retailer: 'carrefour' }),
      'an extra line': cart({ lines: [line(), line({ index: 1, skuId: '777' })] }),
    };
    for (const [what, c] of Object.entries(variants)) {
      assert.notEqual(toHex(await basketHash(c)), base, `${what} left the basket hash unchanged`);
    }
  });
});

describe('openArgs', () => {
  const ok = {
    buyer: 'GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK',
    orderId: bytes(32, 1),
    amountUnits: 250_000_000n,
    basketHash: bytes(32, 2),
  };

  it('encodes each argument as the type Soroban expects', () => {
    const args = openArgs(ok);
    assert.deepEqual(
      args.map((a) => a.type),
      ['address', 'bytes', 'i128', 'bytes', 'u64'],
    );
    assert.equal(args[0].value, ok.buyer);
    assert.equal(args[1].value, toBase64(ok.orderId));
    assert.equal(args[2].value, '250000000');
    assert.equal(args[4].value, String(DEFAULT_TIMEOUT_SECS));
    assert.ok(DEFAULT_TIMEOUT_SECS >= MIN_TIMEOUT_SECS && DEFAULT_TIMEOUT_SECS <= MAX_TIMEOUT_SECS);
  });

  it('refuses a hash, amount or timeout the contract would reject', () => {
    assert.throws(() => openArgs({ ...ok, orderId: bytes(31) }), /32 bytes/);
    assert.throws(() => openArgs({ ...ok, basketHash: bytes(33) }), /32 bytes/);
    assert.throws(() => openArgs({ ...ok, amountUnits: 0n }), /positive/);
    assert.throws(() => openArgs({ ...ok, amountUnits: -1n }), /positive/);
    assert.throws(() => openArgs({ ...ok, timeoutSecs: MIN_TIMEOUT_SECS - 1 }), /timeout_secs/);
    assert.throws(() => openArgs({ ...ok, timeoutSecs: MAX_TIMEOUT_SECS + 1 }), /timeout_secs/);
  });
});

describe('RULE: the args match the contract they are sent to', () => {
  it('open() still takes (buyer, order_id, amount, basket_hash, timeout_secs)', async () => {
    const src = await readFile(new URL('../../../../contracts/escrow/src/lib.rs', import.meta.url), 'utf8');
    const sig = /pub fn open\(\s*env: Env,([^)]*)\)/.exec(src);
    assert.ok(sig, 'could not find `pub fn open` in the escrow contract');

    const declared = sig[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(':').map((x) => x.trim()));

    assert.deepEqual(
      declared.map(([name]) => name),
      ['buyer', 'order_id', 'amount', 'basket_hash', 'timeout_secs'],
    );
    assert.deepEqual(
      declared.map(([, type]) => type),
      ['Address', 'BytesN<32>', 'i128', 'BytesN<32>', 'u64'],
    );

    const bounds = /const MIN_TIMEOUT: u64 = (\d+);[\s\S]*?const MAX_TIMEOUT: u64 = ([^;]+);/.exec(src);
    assert.ok(bounds, 'could not find the timeout bounds');
    assert.equal(Number(bounds[1]), MIN_TIMEOUT_SECS);
    assert.equal(
      bounds[2].split('*').reduce((n, x) => n * Number(x.trim()), 1),
      MAX_TIMEOUT_SECS,
    );
  });
});

describe('canonicalReceipt', () => {
  const input = {
    orderId: '20f8af41e9932bbf0d2d3c00bde344a087d3d0c1c8f9a2c0045f97f9fb736e6e',
    buyer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    basketHash: '09f717841992aabcb6a6925fdae396718d5e9b2c43b6bb35330429523ed89798',
    amountUnits: '34400000',
    settledAt: '2026-09-20T14:30:00.000Z',
  };

  it('records only what the contract and the server know, and hashes that', async () => {
    const lines = canonicalReceipt(input).split('\n');
    assert.deepEqual(lines.slice(1, 6), [
      `order|${input.orderId}`,
      `buyer|${input.buyer}`,
      `basket|${input.basketHash}`,
      `amount|${input.amountUnits}`,
      'basis|buyer-confirmed',
    ]);
    assert.doesNotMatch(canonicalReceipt(input), /retailer|cart\||handoff/);

    const a = await receiptHash(input);
    assert.equal(a.length, 32);
    const b = await receiptHash({ ...input, settledAt: '2026-09-20T14:30:01.000Z' });
    assert.notEqual(toHex(a), toHex(b));
    assert.notEqual(toHex(a), toHex(await basketHash(cart())));
  });
});
