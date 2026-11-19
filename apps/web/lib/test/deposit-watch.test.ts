import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchDeposit, stroops, type PaymentRecord } from '../deposit-watch.ts';

/**
 * The fixture is a real transaction.
 *
 * On 2026-09-25 two testnet accounts were funded by friendbot and one paid the
 * other 12.5 XLM with `MEMO_TEXT: "K7M2PQ9X"`. Horizon's own payment record
 * for it, read with `.join('transactions')`, is what these fields are — down
 * to `12.5000000` rather than `12.5`, and to the joined transaction arriving
 * as `transaction_attr` while `transaction` is a lazy fetch function.
 *
 * That is the point of copying it rather than inventing a shape. A matcher
 * tested only against a hand-written record passes while reading the wrong
 * field on the real one, and the failure is silent: no deposit ever matches,
 * and the shopper sits in front of "esperando el pago" forever.
 */
const DEPOT = 'GDYSKGLYEO2WJSI6TWJNKEMAPLM6J5WCXH5HYRLLPIUNGOI77W22PNGB';
const MEMO = 'K7M2PQ9X';
const XLM = { code: 'XLM', issuer: null } as const;
const USDC = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' } as const;

const real: PaymentRecord = {
  type: 'payment',
  to: DEPOT,
  asset_type: 'native',
  amount: '12.5000000',
  transaction_hash: 'f23cf842000557fee4dd11e77119cebd235c48ab65e51221c295ca21772b1d41',
  created_at: '2026-09-25T19:51:52Z',
  transaction_successful: true,
  transaction_attr: { memo: MEMO, memo_type: 'text', successful: true },
};

const want = { to: DEPOT, asset: XLM, memo: MEMO, minAmount: '12.5' };

describe('matching a deposit', () => {
  it('finds the real payment', () => {
    const hit = matchDeposit([real], want);
    assert.equal(hit?.txHash, real.transaction_hash);
    assert.equal(hit?.amount, '12.5000000');
    const noise: PaymentRecord[] = [
      { type: 'payment', to: DEPOT, asset_type: 'native', amount: '99', transaction_attr: { memo: 'ZZZZZZZZ', memo_type: 'text' } },
      { type: 'create_account', to: DEPOT, asset_type: 'native' },
      real,
    ];
    assert.equal(matchDeposit(noise, want)?.txHash, real.transaction_hash);
  });

  it('takes more than quoted, never less', () => {
    const over = { ...real, amount: '13.0000000' };
    assert.equal(matchDeposit([over], want)?.amount, '13.0000000');
    assert.ok(matchDeposit([real], { ...want, minAmount: '12.4999999' }));
    assert.equal(matchDeposit([real], { ...want, minAmount: '12.5000001' }), null);
    // An unparseable minimum must not be treated as zero.
    assert.equal(matchDeposit([real], { ...want, minAmount: 'NaN' }), null);
  });

  it('RULE: the memo has to be exactly right', () => {
    const idMemo = { ...real, transaction_attr: { memo: MEMO, memo_type: 'id', successful: true } };
    const bare = { ...real, transaction_attr: { successful: true } };
    // The SDK does not put the memo on `transaction`; a record that only has it
    // there is the bug this fixture exists to catch.
    const wrongField = { ...real, transaction_attr: undefined } as PaymentRecord;
    const misses: Array<[PaymentRecord, typeof want]> = [
      [real, { ...want, memo: 'K7M2PQ9Y' }],
      // Lowercase is not the same memo. The alphabet is uppercase-only.
      [real, { ...want, memo: MEMO.toLowerCase() }],
      [idMemo, want],
      [bare, want],
      [wrongField, want],
    ];
    for (const [rec, w] of misses) assert.equal(matchDeposit([rec], w), null);
  });

  it('RULE: the asset has to be the asset', () => {
    assert.equal(matchDeposit([real], { ...want, asset: USDC }), null);

    const usdcRecord: PaymentRecord = {
      ...real,
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: USDC.issuer,
    };
    assert.ok(matchDeposit([usdcRecord], { ...want, asset: USDC }));
    // Right code, wrong issuer. "USDC" is a string anyone may issue, and an
    // asset that only looks like money is not money.
    const impostor = { ...usdcRecord, asset_issuer: DEPOT };
    assert.equal(matchDeposit([impostor], { ...want, asset: USDC }), null);
    // Native is matched by type, so a credit asset cannot pass as XLM.
    assert.equal(matchDeposit([usdcRecord], want), null);
  });

  it('a payment that did not land is not a match', () => {
    // A create_account moves XLM too, and spells the amount `starting_balance`.
    const created: PaymentRecord = {
      type: 'create_account',
      to: DEPOT,
      asset_type: 'native',
      transaction_attr: { memo: MEMO, memo_type: 'text', successful: true },
    };
    const cases: Array<[PaymentRecord[], typeof want]> = [
      [[real], { ...want, to: USDC.issuer }],
      [[created], want],
      [[{ ...real, transaction_successful: false }], want],
      [[{ ...real, transaction_attr: { ...real.transaction_attr, successful: false } }], want],
      [[], want],
    ];
    for (const [rows, w] of cases) assert.equal(matchDeposit(rows, w), null);
  });
});

describe('stroops', () => {
  it('RULE: compares money as integers', () => {
    // 0.1 + 0.2 > 0.3 in binary floating point. Seven decimals of someone's
    // money is not a place to find that out.
    assert.equal(stroops('0.1')! + stroops('0.2')! > stroops('0.3')!, false);
    assert.equal(stroops('0.1')! + stroops('0.2')!, stroops('0.3')!);
    assert.equal(stroops('1'), 10_000_000n);
    assert.equal(stroops('1.5'), 15_000_000n);
    assert.equal(stroops('1.5000000'), 15_000_000n);
    assert.equal(stroops('0.0000001'), 1n);
    for (const bad of ['', '-1', '1.23456789', 'abc', '1e7', '1.', '.5', ' 1 ', 'Infinity', 'NaN']) {
      assert.equal(stroops(bad), null, bad);
    }
  });
});
