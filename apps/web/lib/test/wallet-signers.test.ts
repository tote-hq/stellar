import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  signAuthEntryWith,
  signTransactionWith,
  type AuthEntryResult,
  type TxSignResult,
  type WalletSignClient,
} from '../wallet-signers.ts';

function fakeClient(overrides: Partial<WalletSignClient>): WalletSignClient {
  return {
    signAuthEntry: async () => ({ status: 'error', details: 'unset' }),
    signTx: async () => ({ status: 'error', details: 'unset' }),
    ...overrides,
  };
}

describe('signAuthEntryWith', () => {
  it('returns the signed auth entry when the wallet signs', async () => {
    const client = fakeClient({
      signAuthEntry: async () => ({
        status: 'signed',
        signedAuthEntry: 'signed-entry-xdr',
      }),
    });
    const result = await signAuthEntryWith(client, 'entry-xdr', { validUntilLedger: 100 });
    assert.deepEqual(result, {
      status: 'signed',
      signedAuthEntry: 'signed-entry-xdr',
    } satisfies AuthEntryResult);
  });

  it('returns an error when the wallet rejects, without throwing', async () => {
    const declined = fakeClient({
      signAuthEntry: async () => ({
        status: 'error',
        details: 'User declined access',
      }),
    });
    const declinedResult = await signAuthEntryWith(declined, 'entry-xdr', { validUntilLedger: 100 });
    assert.equal(declinedResult.status, 'error');
    if (declinedResult.status === 'error') {
      assert.equal(declinedResult.details, 'User declined access');
    }

    const thrown = fakeClient({
      signAuthEntry: async () => {
        throw new Error('User declined access');
      },
    });
    const thrownResult = await signAuthEntryWith(thrown, 'entry-xdr', { validUntilLedger: 100 });
    assert.deepEqual(thrownResult, {
      status: 'error',
      details: 'User declined access',
    });

    // Pollar returns status:error for passkey wallets; they cannot sign an entry.
    const smart = fakeClient({
      signAuthEntry: async () => ({
        status: 'error',
        details: 'Smart wallets cannot sign auth entries',
      }),
    });
    const smartResult = await signAuthEntryWith(smart, 'entry-xdr', { validUntilLedger: 42 });
    assert.equal(smartResult.status, 'error');
  });
});

describe('signTransactionWith', () => {
  it('returns the signed XDR when the wallet signs', async () => {
    const client = fakeClient({
      signTx: async () => ({ status: 'signed', signedXdr: 'signed-tx-xdr' }),
    });
    const result = await signTransactionWith(client, 'unsigned-xdr');
    assert.deepEqual(result, {
      status: 'signed',
      signedXdr: 'signed-tx-xdr',
    } satisfies TxSignResult);
  });
});
