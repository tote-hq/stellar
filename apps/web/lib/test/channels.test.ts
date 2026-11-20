import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Account, Address, xdr } from '@stellar/stellar-sdk';
import {
  PluginExecutionError,
  PluginTransportError,
} from '@openzeppelin/relayer-plugin-channels/dist/client/index.js';

import { contractIds } from '../contract-ids.ts';
import { DEPLOYMENTS } from '../deployments.ts';
import { DEFAULT_TIMEOUT_SECS } from '../order.ts';
import {
  assertBuyerEntries,
  buildOpenFuncForBuyer,
  ChannelsFailure,
  mapChannelsError,
  prepareOpen,
  setAuthExpiry,
  stellarSimulator,
  submitOpen,
  type ChannelsDeps,
  type OpenFields,
  type SimulationRpc,
} from '../server/channels.ts';

const ESCROW = 'CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S';
const BUYER = 'GDFF477UQUWOFIHSOEXPPOD5GPUSEW6OLGZB5FCPS6AFRAOPTMINA55X';
const OTHER = 'GBXBAOFWG4Y4ZQEDXH73BACYYCE7ODSKXHLXYVRPLJOYFRDCPWHGYGN5';
const ORDER = '11'.repeat(32);
const BASKET = '22'.repeat(32);

function input(over: Partial<OpenFields> = {}): OpenFields {
  return {
    orderId: ORDER,
    amount: '1000000',
    basketHash: BASKET,
    timeoutSecs: DEFAULT_TIMEOUT_SECS,
    contractId: ESCROW,
    method: 'open',
    network: 'testnet',
    ...over,
  };
}

function entry(buyer: string, funcXdr: string, kind: 'address' | 'source' = 'address'): string {
  const parsed = xdr.HostFunction.fromXDR(funcXdr, 'base64');
  if (parsed.type !== 'hostFunctionTypeInvokeContract') throw new Error('not an invoke');
  const invoke = parsed.invokeContract;
  const transfer = new xdr.InvokeContractArgs({
    contractAddress: new Address(contractIds('testnet').usdcId).toScAddress(),
    functionName: 'transfer',
    args: [],
  });
  const credentials = kind === 'source'
    ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
    : xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(buyer).toScAddress(),
      nonce: 1n,
      signatureExpirationLedger: 1,
      signature: xdr.ScVal.scvVoid(),
    }));
  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke),
      subInvocations: [
        new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(transfer),
          subInvocations: [],
        }),
      ],
    }),
  }).toXDR('base64');
}

function deps(over: Partial<ChannelsDeps> = {}): ChannelsDeps {
  return {
    apiKey: 'test-key',
    client: { async submitSorobanTransaction() { return { hash: 'ab'.repeat(32) }; } },
    simulator: { async simulate() { return { auth: [], latestLedger: 1000 }; } },
    loadRecord: async () => null,
    readOpened: async () => false,
    findOpenHash: async () => null,
    sleep: async () => {},
    ...over,
  };
}

describe('channels open', () => {
  it('targets the runtime escrow, not the recorded one', () => {
    const runtime = 'CDBGEMWESQJNEGBJ46TMPXNI5KFZN5B23W6ACO6NZFQATWWYY2WW3HDF';
    process.env.STELLAR_ESCROW_ID = runtime;
    const parsed = xdr.HostFunction.fromXDR(
      buildOpenFuncForBuyer(input({ contractId: runtime }), BUYER),
      'base64',
    );
    if (parsed.type !== 'hostFunctionTypeInvokeContract') throw new Error('not an invoke');
    const contract = Address.fromScAddress(parsed.invokeContract.contractAddress).toString();
    assert.equal(contract, runtime);
    assert.notEqual(contract, DEPLOYMENTS.testnet.escrowId);
    assert.equal(String(parsed.invokeContract.functionName), 'open');
    assert.throws(
      () => buildOpenFuncForBuyer(input({ contractId: DEPLOYMENTS.testnet.escrowId }), BUYER),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 400,
    );
  });

  it('refuses mainnet', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    assert.throws(
      () => buildOpenFuncForBuyer(input({ network: 'mainnet' }), BUYER),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_mainnet',
    );
  });

  it('checks the buyer entry and rejects the wrong shapes', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    assert.doesNotThrow(() => assertBuyerEntries([entry(BUYER, func)], BUYER, func));
    assert.throws(() => assertBuyerEntries([entry(OTHER, func)], BUYER, func), /autorización/);
    assert.throws(() => assertBuyerEntries([entry(BUYER, func, 'source')], BUYER, func), /autorización/);
    const other = buildOpenFuncForBuyer(input({ amount: '2' }), BUYER);
    assert.throws(() => assertBuyerEntries([entry(BUYER, other)], BUYER, func), /autorización/);
    assert.throws(() => assertBuyerEntries([entry(BUYER, func), entry(BUYER, func)], BUYER, func), /autorización/);
  });

  it('prepare returns the quoted entry and an existing signature', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const prepared = await prepareOpen(input(), BUYER, deps({
      simulator: { async simulate() { return { auth: [entry(BUYER, func)], latestLedger: 1000 }; } },
    }));
    assert.equal(prepared.kind, 'sign');
    if (prepared.kind !== 'sign') return;
    assert.equal(prepared.validUntilLedger, 1060);
    const again = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => ({ buyer: BUYER, amount: '1000000', basketHash: BASKET, openSig: 'cd'.repeat(32) }),
      simulator: { async simulate() { throw new Error('should not simulate'); } },
    }));
    assert.deepEqual(again, { kind: 'opened', hash: 'cd'.repeat(32) });
  });

  it('returns 503 when the key is unset', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ apiKey: undefined })),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 503 && err.code === 'channels_unconfigured',
    );
  });

  it('submit rebuilds the call and ignores any other function', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let seen = '';
    const sent = await submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
      client: { async submitSorobanTransaction(req) { seen = req.func; return { hash: 'ab'.repeat(32) }; } },
    }));
    assert.equal(seen, func);
    assert.equal(sent.hash, 'ab'.repeat(32));
  });

  it('maps each channels failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const signed = [entry(BUYER, func)];
    const cases: Array<[unknown, string, number, number, string]> = [
      [new PluginExecutionError('fee', { code: 'FEE_LIMIT_EXCEEDED', status: 429, details: {} }), 'channels_fee_cap', 503, 1, 'fee'],
      [new PluginExecutionError('pool', { code: 'POOL_CAPACITY', status: 503, details: {} }), 'channels_pool', 503, 3, 'pool'],
      [new PluginExecutionError('expiry', { code: 'AUTH_EXPIRY_TOO_SHORT', status: 400, details: {} }), 'channels_auth_expiry', 409, 1, 'expiry'],
      [new PluginExecutionError('Simulation failed', { code: 'SIMULATION_FAILED', status: 400, details: { error: 'account not found', authMode: 'enforce' } }), 'channels_account', 409, 1, 'account'],
      [new PluginExecutionError('Simulation failed', { code: 'SIMULATION_FAILED', status: 400, details: { error: 'insufficient balance', authMode: 'enforce' } }), 'channels_balance', 409, 1, 'balance'],
      [new PluginExecutionError('auth', { code: 'SIMULATION_SIGNED_AUTH_VALIDATION_FAILED', status: 400, details: {} }), 'channels_auth', 400, 1, 'auth'],
      [new PluginExecutionError('host error', { code: 'ONCHAIN_FAILED', status: 400, details: { status: 'failed', reason: 'OrderExists', id: '1', hash: null, resultCode: 'OrderExists', labUrl: null } }), 'channels_onchain', 409, 1, 'onchain'],
    ];
    for (const [thrown, code, status, calls, label] of cases) {
      let n = 0;
      await assert.rejects(
        () => submitOpen(input(), BUYER, signed, deps({
          client: { async submitSorobanTransaction() { n += 1; throw thrown; } },
        })),
        (err: unknown) => err instanceof ChannelsFailure && err.code === code && err.status === status,
      );
      assert.equal(n, calls, label);
    }
    const waiting = mapChannelsError({ message: 'WAIT_TIMEOUT' });
    assert.equal(waiting.code, 'channels_wait');
    await assert.rejects(
      () => submitOpen(input(), BUYER, signed, deps({
        readOpened: async () => true,
        client: { async submitSorobanTransaction() { throw { message: 'WAIT_TIMEOUT' }; } },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    const quiet = mapChannelsError(new PluginExecutionError(
      'Simulation failed',
      { code: 'SIMULATION_FAILED', status: 400, details: { error: 'Simulation failed', authMode: 'enforce' } },
    ));
    assert.equal(quiet.code, 'channels_sim');
    assert.doesNotMatch(quiet.message, /USDC/);
  });
});

describe('channels structured errors', () => {
  const LANDED = 'ef'.repeat(32);

  function pluginExec(code: string, details: unknown = {}, message = code) {
    return new PluginExecutionError(message, { code, status: 400, details });
  }

  it('retries a transport error and does not retry a timeout that only looks like one', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let n = 0;
    let saved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        saveAttempt: async () => { saved += 1; },
        client: {
          async submitSorobanTransaction() {
            n += 1;
            throw pluginExec('ONCHAIN_FAILED', {
              status: 'failed',
              reason: 'boom',
              id: '1',
              hash: null,
              resultCode: null,
              labUrl: null,
              ledger: 1502,
            });
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_onchain',
    );
    assert.equal(n, 1);
    assert.equal(saved, 0);

    let transportCalls = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        client: {
          async submitSorobanTransaction() {
            transportCalls += 1;
            throw new PluginTransportError('bad gateway', 502);
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_pool' && err.status === 503,
    );
    assert.equal(transportCalls, 3);

    const failed = 'cd'.repeat(32);
    let onchainSaved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => false,
        saveAttempt: async () => { onchainSaved += 1; },
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('ONCHAIN_FAILED', {
              status: 'failed',
              reason: 'contract error',
              id: 'tx-2',
              hash: failed,
              resultCode: 'txFailed',
              labUrl: null,
            }, 'contract error');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.code === 'channels_onchain'
        && err.hash === failed,
    );
    assert.equal(onchainSaved, 0);

    let mixed = 0;
    let opened = false;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => opened,
        client: {
          async submitSorobanTransaction() {
            mixed += 1;
            if (mixed === 1) throw new PluginTransportError('bad gateway', 502);
            opened = true;
            throw pluginExec('SIMULATION_FAILED', {
              error: 'HostError: Error(Contract, #1) OrderExists',
              authMode: 'enforce',
            }, 'Simulation failed');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    assert.equal(mixed, 2);
  });

  it('stores WAIT_TIMEOUT hash as openAttemptSig and returns it when the order landed', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const store: {
      buyer: string;
      amount: string;
      basketHash: string;
      orderId: string;
      openSig?: string;
      openAttemptSig?: string;
    } = { buyer: BUYER, amount: '1000000', basketHash: BASKET, orderId: ORDER };
    let opened = false;
    const sent = await submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
      loadRecord: async () => ({ ...store }),
      saveAttempt: async (_orderId, hash) => { store.openAttemptSig = hash; },
      recoverAttempt: async (rec) => {
        if (!rec.openSig && rec.openAttemptSig && opened) {
          store.openSig = rec.openAttemptSig;
          return { ...rec, openSig: rec.openAttemptSig };
        }
        return rec;
      },
      readOpened: async () => opened,
      client: {
        async submitSorobanTransaction() {
          opened = true;
          throw pluginExec('WAIT_TIMEOUT', { hash: LANDED }, 'WAIT_TIMEOUT');
        },
      },
    }));
    assert.equal(store.openAttemptSig, LANDED);
    assert.equal(sent.hash, LANDED);

    let simulated = 0;
    const prepared = await prepareOpen(input(), BUYER, deps({
      loadRecord: async () => ({
        orderId: ORDER,
        buyer: BUYER,
        amount: '1000000',
        basketHash: BASKET,
        openAttemptSig: LANDED,
      }),
      recoverAttempt: async (rec) => ({ ...rec, openSig: rec.openAttemptSig }),
      simulator: {
        async simulate() {
          simulated += 1;
          return { auth: [], latestLedger: 1000 };
        },
      },
    }));
    assert.deepEqual(prepared, { kind: 'opened', hash: LANDED });
    assert.equal(simulated, 0);
  });

  it('submit rejects a record that does not match the quote', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        loadRecord: async () => ({
          orderId: ORDER,
          buyer: OTHER,
          amount: '1000000',
          basketHash: BASKET,
        }),
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.status === 409 && err.code === 'channels_record',
    );
  });

  it('SIMULATION_FAILED OrderExists with a matching order is not a failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => true,
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('SIMULATION_FAILED', {
              error: 'HostError: Error(Contract, #1) OrderExists',
              authMode: 'enforce',
            }, 'Simulation failed');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
  });

  it('WAIT_TIMEOUT with a null hash and the order on chain is not a failure', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let saved = 0;
    await assert.rejects(
      () => submitOpen(input(), BUYER, [entry(BUYER, func)], deps({
        readOpened: async () => true,
        saveAttempt: async () => { saved += 1; },
        client: {
          async submitSorobanTransaction() {
            throw pluginExec('WAIT_TIMEOUT', { id: 'sub-1', hash: null }, 'WAIT_TIMEOUT');
          },
        },
      })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_confirming',
    );
    assert.equal(saved, 0);
  });

});

describe('channels live simulator', () => {
  const USDC = contractIds('testnet').usdcId;

  /** Shaped like testnet's answer for an open whose buyer holds no mock USDC. */
  const LOW_BALANCE = [
    'HostError: Error(Contract, #4)',
    '',
    'Event log (newest first):',
    `   0: [Diagnostic Event] contract:${ESCROW}, topics:[error, Error(Contract, #4)], data:"escalating error to VM trap from failed host function call: call"`,
    `   1: [Diagnostic Event] contract:${ESCROW}, topics:[error, Error(Contract, #4)], data:["contract call failed", transfer, [${BUYER}, ${ESCROW}, 1000000]]`,
    `   2: [Failed Diagnostic Event (not emitted)] contract:${USDC}, topics:[error, Error(Contract, #4)], data:["failing with contract error", 4]`,
  ].join('\n');

  const ORDER_EXISTS = [
    'HostError: Error(Contract, #3)',
    '',
    'Event log (newest first):',
    `   0: [Diagnostic Event] contract:${ESCROW}, topics:[error, Error(Contract, #3)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"`,
  ].join('\n');

  /**
   * An RPC whose ledger header the installed SDK cannot decode, as testnet's
   * protocol 30 header is for SDK 17.1. Only simulateTransaction works.
   */
  function rpcStub(answer: (tx: unknown) => unknown): SimulationRpc {
    const stub = {
      async getAccount(id: string) { return new Account(id, '1'); },
      async getLatestLedger() { throw new Error('LedgerHeader.scpValue.ext.v: unknown enum value 3'); },
      async simulateTransaction(tx: unknown) { return answer(tx); },
    };
    return stub as unknown as SimulationRpc;
  }

  /** Protocol 30 testnet records the buyer's auth as `ADDRESS_V2`. */
  function entryV2(buyer: string, func: string): xdr.SorobanAuthorizationEntry {
    const legacy = xdr.SorobanAuthorizationEntry.fromXDR(entry(buyer, func), 'base64');
    if (legacy.credentials.type !== 'sorobanCredentialsAddress') throw new Error('not address credentials');
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(legacy.credentials.address),
      rootInvocation: legacy.rootInvocation,
    });
  }

  function simulated(func: string, latestLedger: number) {
    return {
      id: '1',
      latestLedger,
      events: [],
      _parsed: true,
      result: { auth: [entryV2(BUYER, func)], retval: xdr.ScVal.scvVoid() },
    };
  }

  it('prepare returns the buyer entries without asking for the latest ledger', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    let source = '';
    const simulator = stellarSimulator('testnet', rpcStub((tx) => {
      source = (tx as { source: string }).source;
      return simulated(func, 5000);
    }));
    const out = await prepareOpen(input(), BUYER, deps({ simulator }));
    assert.equal(out.kind, 'sign');
    if (out.kind !== 'sign') return;
    assert.equal(out.validUntilLedger, 5060);
    assert.equal(out.entries.length, 1);
    assert.equal(out.func, func);
    assert.equal(source, DEPLOYMENTS.testnet.resolver);
  });

  it('keeps ADDRESS_V2 credentials and sets their expiry', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const renewed = xdr.SorobanAuthorizationEntry.fromXDR(setAuthExpiry(entryV2(BUYER, func).toXDR('base64'), 4321), 'base64');
    assert.equal(renewed.credentials.type, 'sorobanCredentialsAddressV2');
    if (renewed.credentials.type !== 'sorobanCredentialsAddressV2') return;
    assert.equal(renewed.credentials.addressV2.signatureExpirationLedger, 4321);
    assert.doesNotThrow(() => assertBuyerEntries([renewed.toXDR('base64')], BUYER, func));
  });

  it('refuses ADDRESS_V2 credentials for anyone but the buyer', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    assert.throws(
      () => assertBuyerEntries([entryV2(OTHER, func).toXDR('base64')], BUYER, func),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_auth',
    );
  });

  it('refuses delegated credentials', () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const func = buildOpenFuncForBuyer(input(), BUYER);
    const legacy = xdr.SorobanAuthorizationEntry.fromXDR(entry(BUYER, func), 'base64');
    if (legacy.credentials.type !== 'sorobanCredentialsAddress') throw new Error('not address credentials');
    const delegated = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
        new xdr.SorobanAddressCredentialsWithDelegates({ addressCredentials: legacy.credentials.address, delegates: [] }),
      ),
      rootInvocation: legacy.rootInvocation,
    }).toXDR('base64');
    assert.throws(() => setAuthExpiry(delegated, 10), /autorización/);
    assert.throws(() => assertBuyerEntries([delegated], BUYER, func), /autorización/);
  });

  it('calls a failed token transfer a balance problem', async () => {
    process.env.STELLAR_ESCROW_ID = ESCROW;
    const simulator = stellarSimulator('testnet', rpcStub(() => ({ id: '1', latestLedger: 5000, events: [], _parsed: true, error: LOW_BALANCE })));
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.code === 'channels_balance'
        && err.message === 'No alcanza el USDC para este pedido.',
    );
    const exists = stellarSimulator('testnet', rpcStub(() => ({ id: '1', latestLedger: 5000, events: [], _parsed: true, error: ORDER_EXISTS })));
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator: exists })),
      (err: unknown) => err instanceof ChannelsFailure && err.code === 'channels_exists',
    );
    const unknown = stellarSimulator('testnet', rpcStub(() => ({
      id: '1', latestLedger: 5000, events: [], _parsed: true, error: 'HostError: Error(WasmVm, InvalidAction)',
    })));
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator: unknown })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.code === 'channels_sim'
        && !/HostError|WasmVm/.test(err.message),
    );
    const thrown = { async simulate(): Promise<never> { throw new Error('LedgerHeader.scpValue.ext.v: unknown enum value 3'); } };
    await assert.rejects(
      () => prepareOpen(input(), BUYER, deps({ simulator: thrown })),
      (err: unknown) => err instanceof ChannelsFailure
        && err.status === 502
        && err.code === 'channels_rpc'
        && err.message === 'La red no pudo simular el pago.',
    );
  });

});
