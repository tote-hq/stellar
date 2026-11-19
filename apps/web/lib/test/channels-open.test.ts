import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Address, Keypair, hash, xdr } from '@stellar/stellar-sdk';

import { entryForCustodial, preimageForWallet, walletAuthEntry } from '../auth-entry.ts';
import { openThroughChannels, type ChannelOpen } from '../channels-open.ts';

const PASS = 'Test SDF Network ; September 2015';
const HASH = 'ab'.repeat(32);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function entryV2(buyer: string): string {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address('CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S').toScAddress(),
        functionName: 'open',
        args: [],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(buyer).toScAddress(),
        nonce: 7n,
        signatureExpirationLedger: 4321,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  }).toXDR('base64');
}

function signatureFor(entry: string, signer: Keypair): string {
  const preimage = xdr.HashIdPreimage.fromXDR(preimageForWallet(entry, PASS), 'base64');
  return Buffer.from(signer.sign(hash(preimage.toXDR()))).toString('base64');
}

/** Prepare returns one simulated entry. Submit records the auth that would be sent. */
function stubChannels(entry: string): { submitted: () => string[] } {
  let auth: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { step?: string; auth?: string[] };
    if (body.step === 'submit') auth = body.auth ?? [];
    const payload = body.step === 'prepare'
      ? { entries: [entry], validUntilLedger: 5000 }
      : { hash: HASH };
    return { ok: true, status: 200, json: async () => payload } as Response;
  }) as typeof fetch;
  return { submitted: () => auth };
}

function open(signer: ChannelOpen['signAuthEntry'], walletKind: ChannelOpen['walletKind']) {
  return openThroughChannels({
    network: 'testnet',
    contractId: 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S',
    method: 'open',
    orderId: 'aa'.repeat(32),
    amount: '1',
    basketHash: 'bb'.repeat(32),
    timeoutSecs: 3600,
    signAuthEntry: signer,
    walletKind,
  });
}

describe('what the wallet is asked to sign', () => {
  it('gives a custodial wallet a V1 entry and submits the signed entry unchanged', async () => {
    const signer = Keypair.random();
    const entry = entryV2(signer.publicKey());
    const complete = walletAuthEntry(entry, signatureFor(entry, signer), PASS);
    const channels = stubChannels(entry);
    let received = '';
    const hash = await open(async (payload, options) => {
      received = payload;
      assert.equal(options.validUntilLedger, 5000);
      return { status: 'signed', signedAuthEntry: complete };
    }, 'custodial');

    const parsed = xdr.SorobanAuthorizationEntry.fromXDR(received, 'base64');
    assert.equal(parsed.credentials.type, 'sorobanCredentialsAddress');
    if (parsed.credentials.type !== 'sorobanCredentialsAddress') return;
    assert.equal(Address.fromScAddress(parsed.credentials.address.address).toString(), signer.publicKey());
    assert.equal(parsed.credentials.address.signature.toXDR('base64'), xdr.ScVal.scvVoid().toXDR('base64'));
    assert.equal(parsed.rootInvocation.toXDR('base64'), xdr.SorobanAuthorizationEntry.fromXDR(entry, 'base64').rootInvocation.toXDR('base64'));
    assert.equal(received, entryForCustodial(entry));
    assert.equal(hash, HASH);
    assert.deepEqual(channels.submitted(), [complete]);
  });

  it('still gives an external wallet the V1 preimage', async () => {
    const signer = Keypair.random();
    const entry = entryV2(signer.publicKey());
    stubChannels(entry);
    let received = '';
    const hash = await open(async (payload, options) => {
      received = payload;
      assert.equal(options.validUntilLedger, 5000);
      const preimage = xdr.HashIdPreimage.fromXDR(payload, 'base64');
      assert.equal(preimage.type, 'envelopeTypeSorobanAuthorization');
      return { status: 'signed', signedAuthEntry: signatureFor(entry, signer) };
    }, 'external');

    assert.equal(received, preimageForWallet(entry, PASS));
    assert.equal(hash, HASH);
  });

  it('rejects a signed entry whose invocation is not the simulated one', async () => {
    const signer = Keypair.random();
    const entry = entryV2(signer.publicKey());
    const complete = xdr.SorobanAuthorizationEntry.fromXDR(
      walletAuthEntry(entry, signatureFor(entry, signer), PASS),
      'base64',
    );
    const mismatched = new xdr.SorobanAuthorizationEntry({
      credentials: complete.credentials,
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address('CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S').toScAddress(),
            functionName: 'close',
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    }).toXDR('base64');
    stubChannels(entry);
    await assert.rejects(
      () => open(async () => ({ status: 'signed', signedAuthEntry: mismatched }), 'custodial'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as { code?: string }).code, 'channels_rejected');
        return true;
      },
    );
  });

  it('surfaces the signer error detail', async () => {
    stubChannels(entryV2(Keypair.random().publicKey()));
    const detail = 'SOROBAN_AUTH_ENTRY_INVALID: entryXdr is not a valid SorobanAuthorizationEntry';
    await assert.rejects(
      () => open(async () => ({ status: 'error', details: detail }), 'custodial'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, detail);
        assert.equal((err as { code?: string }).code, 'channels_rejected');
        return true;
      },
    );
  });
});
