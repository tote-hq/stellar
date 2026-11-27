import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import { Keypair } from '@stellar/stellar-sdk';

import type { AdminStore, PendingPrompt } from '../admin/store.ts';
import type { CheckoutRecord } from '../checkout/store.ts';
import type { SandboxJob, SandboxPhase } from '../checkout/sandbox.ts';

/**
 * The operator's question is a row on this order. Status returns it while the
 * job is still running, and the shopper's answer does not go to the sandbox.
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';
env.CHG_SESSION_SECRET = 'session-test-secret';
env.ADMIN_SESSION_SECRET = 'test-only-admin-secret';
env.SANDBOX_URL = 'https://sandbox.test';
env.SANDBOX_TOKEN = 'tok';
delete env.DATABASE_URL;

const ORDER_A = 'a1'.repeat(32);
const ORDER_B = 'b2'.repeat(32);
const JOB_A = 'job-a';
const JOB_B = 'job-b';
const BUYER = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const ADMIN_LABEL = '¿Reemplazo la leche?';
const AGENT_LABEL = '¿Qué cantidad?';

mock.module(new URL('../checkout/escrow-server.ts', import.meta.url).href, {
  namedExports: {
    async readOrder() {
      const now = Math.floor(Date.now() / 1000);
      return {
        orderId: ORDER_A,
        buyer: BUYER,
        amount: 10_000_000n,
        basketHash: 'ab'.repeat(32),
        status: 'open' as const,
        openedAt: now - 30,
        deadline: now + 3600,
        receiptHash: '00'.repeat(32),
      };
    },
    async settleOrder() {
      return '11'.repeat(32);
    },
    async refundOrder() {
      return '22'.repeat(32);
    },
  },
});

interface PromptRow {
  id: string;
  orderId: string;
  label: string;
  fieldRef: string | null;
  options: PendingPrompt['options'];
  source: 'agent' | 'admin';
  status: 'pending' | 'answered';
  answer?: string;
}

const prompts: PromptRow[] = [];
const notes: { kind: string; orderId: string; body: string }[] = [];
const opens: { source: 'agent' | 'admin'; result: 'ok' | 'conflict' }[] = [];
const fetched: string[] = [];
const answerRefs: string[] = [];
const jobs = new Map<string, SandboxJob>();
let answerStatus = 200;
let failPending = false;
let seq = 0;

const memoryAdmin: AdminStore = {
  async userByName() {
    return null;
  },
  async failureCount() {
    return 0;
  },
  async recordFailure() {
    return undefined;
  },
  async saveSession() {
    return undefined;
  },
  async sessionByHash() {
    return { adminId: 'op' };
  },
  async dropSession() {
    return undefined;
  },
  async notifications() {
    return [];
  },
  async markRead() {
    return undefined;
  },
  async openPrompt(input) {
    if (prompts.some((row) => row.orderId === input.orderId && row.status === 'pending')) {
      opens.push({ source: input.source, result: 'conflict' });
      return 'conflict';
    }
    prompts.push({
      id: String(++seq),
      orderId: input.orderId,
      label: input.label,
      fieldRef: input.fieldRef,
      options: (input.options ?? null) as PendingPrompt['options'],
      source: input.source,
      status: 'pending',
    });
    opens.push({ source: input.source, result: 'ok' });
    return 'ok';
  },
  async pendingPrompt(orderId) {
    if (failPending) {
      const err = new Error(ADMIN_LABEL);
      err.name = 'QueryFailed';
      throw err;
    }
    const row = prompts.find((item) => item.orderId === orderId && item.status === 'pending');
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.orderId,
      label: row.label,
      fieldRef: row.fieldRef,
      options: row.options,
      source: row.source,
    };
  },
  async answerPrompt(orderId, answer) {
    const row = prompts.find((item) => item.orderId === orderId && item.status === 'pending');
    if (!row) return false;
    row.status = 'answered';
    row.answer = answer;
    return true;
  },
  async notifyOnce(kind, orderId, body) {
    notes.push({ kind, orderId, body });
  },
};

function running(id: string, phase: SandboxPhase, prompt?: SandboxJob['prompt']): SandboxJob {
  return { job_id: id, status: 'running', phase, ...(prompt ? { prompt } : {}) };
}

function record(over: Partial<CheckoutRecord> = {}): CheckoutRecord {
  return {
    orderId: ORDER_A,
    buyer: BUYER,
    amount: '10000000',
    amountCents: 1000,
    basketHash: 'ab'.repeat(32),
    arsPerUsd: 1000,
    totalDisplay: '$10.00',
    retailer: 'coto',
    lines: [],
    handoffUrl: null,
    createdAt: Date.now(),
    jobId: JOB_A,
    openSig: 'cd'.repeat(32),
    checkoutKind: 'coto_real_v1',
    mode: 'live',
    startedAt: Date.now(),
    ...over,
  };
}

function assertOrderIds(): void {
  for (const note of notes) {
    assert.equal(typeof note.orderId, 'string');
    assert.equal(note.orderId === null, false);
    assert.ok(note.orderId.length > 0);
  }
}

describe('admin question on the shopper order', () => {
  let GET: (req: Request) => Promise<Response>;
  let answer: (req: Request) => Promise<Response>;
  let ask: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let store: { set: (rec: CheckoutRecord) => Promise<void> };
  let cookie: string;
  let otherCookie: string;
  let adminCookie: string;
  const logs: string[] = [];
  let errorLog: typeof console.error;

  before(async () => {
    const { mintUserToken, USER_COOKIE } = await import('../login-gate.ts');
    const { signAdminCookie } = await import('../admin/cookie.ts');
    const { __setAdminStoreForTests } = await import('../admin/store.ts');
    cookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(BUYER, 'session-test-secret'))}`;
    otherCookie = `${USER_COOKIE}=${encodeURIComponent(await mintUserToken(OTHER, 'session-test-secret'))}`;
    const token = await signAdminCookie(
      { exp: Date.now() + 60_000, csrf: 'csrf-test', jti: 'jti-test' },
      'test-only-admin-secret',
    );
    assert.ok(token);
    adminCookie = `chg_admin=${token}`;
    __setAdminStoreForTests(memoryAdmin);
    store = (await import('../checkout/store.ts')).checkoutStore();
    GET = (await import('../../app/api/checkout/status/route.ts')).GET;
    answer = (await import('../../app/api/checkout/prompt/route.ts')).POST;
    ask = (await import('../../app/api/admin/orders/[id]/prompt/route.ts')).POST;
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      if (url.includes('/answer')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { field_ref?: string };
        answerRefs.push(body.field_ref ?? '');
        return new Response('{}', { status: answerStatus });
      }
      const match = url.match(/\/jobs\/([^/?]+)$/);
      if (match) {
        const job = jobs.get(decodeURIComponent(match[1] ?? ''));
        if (!job) return new Response('missing', { status: 404 });
        return Response.json(job);
      }
      return new Response('{}', { status: 500 });
    });
  });

  beforeEach(async () => {
    prompts.length = 0;
    notes.length = 0;
    opens.length = 0;
    fetched.length = 0;
    answerRefs.length = 0;
    jobs.clear();
    answerStatus = 200;
    failPending = false;
    logs.length = 0;
    errorLog = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(' '));
    };
    await store.set(record());
    await store.set(record({ orderId: ORDER_B, jobId: JOB_B }));
  });

  after(async () => {
    console.error = errorLog;
    const { __setAdminStoreForTests } = await import('../admin/store.ts');
    __setAdminStoreForTests(null);
    mock.reset();
  });

  const poll = (orderId: string, header = cookie) =>
    GET(new Request(`https://app.changuito.me/api/checkout/status?orderId=${orderId}`, {
      headers: { cookie: header },
    }));

  const shopperAnswer = (orderId: string, value: string) =>
    answer(new Request('https://app.changuito.me/api/checkout/prompt', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, answer: value }),
    }));

  const adminAsk = (orderId: string, label: string) =>
    ask(new Request(`https://admin.changuito.me/api/admin/orders/${orderId}/prompt`, {
      method: 'POST',
      headers: {
        cookie: adminCookie,
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-test',
      },
      body: JSON.stringify({ label }),
    }), { params: Promise.resolve({ id: orderId }) });

  async function seed(orderId: string, label: string, source: 'admin' | 'agent', fieldRef: string) {
    const opened = await memoryAdmin.openPrompt({
      orderId,
      label,
      fieldRef,
      options: null,
      source,
    });
    assert.equal(opened, 'ok');
    opens.length = 0;
  }

  it('returns the operator question while the job is in needs_human or payment', async () => {
    await seed(ORDER_A, ADMIN_LABEL, 'admin', 'admin');
    for (const phase of ['needs_human', 'payment'] as const) {
      jobs.set(JOB_A, running(JOB_A, phase));
      const res = await poll(ORDER_A);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.stage, 'shopping');
      assert.equal(body.prompt.label, ADMIN_LABEL);
      assert.equal(body.prompt.fieldRef, 'admin');
    }
    assertOrderIds();
    assert.equal(logs.join('\n').includes(ADMIN_LABEL), false);
  });

  it('hides that question from another order and another wallet', async () => {
    await seed(ORDER_A, ADMIN_LABEL, 'admin', 'admin');
    jobs.set(JOB_A, running(JOB_A, 'needs_human'));
    jobs.set(JOB_B, running(JOB_B, 'payment'));
    const otherOrder = await poll(ORDER_B);
    assert.equal(otherOrder.status, 200);
    const otherBody = await otherOrder.json();
    assert.equal(otherBody.prompt, undefined);
    const otherWallet = await poll(ORDER_A, otherCookie);
    assert.equal(otherWallet.status, 404);
    assertOrderIds();
  });

  it('keeps the job question when no operator row is pending', async () => {
    jobs.set(JOB_A, running(JOB_A, 'needs_shopper', { label: AGENT_LABEL, fieldRef: 'qty' }));
    const res = await poll(ORDER_A);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.prompt.label, AGENT_LABEL);
    assert.equal(body.prompt.fieldRef, 'qty');
    assert.deepEqual(opens, [{ source: 'agent', result: 'ok' }]);
    assert.equal(notes.some((note) => note.kind === 'needs_shopper' && note.orderId === ORDER_A), true);
    assertOrderIds();
  });

  it('returns the operator row first, then the job row after it is answered', async () => {
    await seed(ORDER_A, ADMIN_LABEL, 'admin', 'admin');
    jobs.set(JOB_A, running(JOB_A, 'needs_shopper', { label: AGENT_LABEL, fieldRef: 'qty' }));
    const first = await poll(ORDER_A);
    const firstBody = await first.json();
    assert.equal(firstBody.prompt.label, ADMIN_LABEL);
    assert.equal(firstBody.prompt.fieldRef, 'admin');
    assert.deepEqual(opens, [{ source: 'agent', result: 'conflict' }]);
    assert.equal(await memoryAdmin.answerPrompt(ORDER_A, 'si'), true);
    const second = await poll(ORDER_A);
    const secondBody = await second.json();
    assert.equal(secondBody.prompt.label, AGENT_LABEL);
    assert.equal(secondBody.prompt.fieldRef, 'qty');
    assert.equal(opens.at(-1)?.result, 'ok');
    assert.equal(opens.at(-1)?.source, 'agent');
    assertOrderIds();
  });

  it('saves an operator answer without calling the sandbox', async () => {
    await seed(ORDER_A, ADMIN_LABEL, 'admin', 'admin');
    jobs.set(JOB_A, running(JOB_A, 'needs_human'));
    const res = await shopperAnswer(ORDER_A, 'descremada');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(answerRefs.length, 0);
    assert.equal(fetched.some((url) => url.includes('/answer')), false);
    const row = prompts.find((item) => item.orderId === ORDER_A);
    assert.equal(row?.status, 'answered');
    const again = await adminAsk(ORDER_A, '¿Sigo con descremada?');
    assert.equal(again.status, 200);
    assert.equal(logs.join('\n').includes('descremada'), false);
  });

  it('forwards a job answer and leaves the row pending when the sandbox refuses', async () => {
    await seed(ORDER_A, AGENT_LABEL, 'agent', 'qty');
    jobs.set(JOB_A, running(JOB_A, 'needs_shopper', { label: AGENT_LABEL, fieldRef: 'qty' }));
    const ok = await shopperAnswer(ORDER_A, 'dos');
    assert.equal(ok.status, 200);
    assert.deepEqual(answerRefs, ['qty']);
    await seed(ORDER_A, AGENT_LABEL, 'agent', 'qty');
    answerStatus = 409;
    const refused = await shopperAnswer(ORDER_A, 'tres');
    assert.equal(refused.status, 502);
    const pending = prompts.find((item) => item.orderId === ORDER_A && item.status === 'pending');
    assert.ok(pending);
    assert.equal(pending.answer, undefined);
    assert.equal(logs.join('\n').includes('tres'), false);
  });

  it('refuses a second operator question while one is pending', async () => {
    const first = await adminAsk(ORDER_A, ADMIN_LABEL);
    assert.equal(first.status, 200);
    const second = await adminAsk(ORDER_A, 'Otra pregunta');
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, 'Ya hay una pregunta pendiente.');
  });

  it('never notifies without an order id', () => {
    const src = readFileSync(new URL('../admin/store.ts', import.meta.url), 'utf8');
    assert.match(src, /notifyOnce\(kind: string, orderId: string, body: string\)/);
    assert.doesNotMatch(src, /notifyOnce\(kind: string, orderId: string \| null/);
    assertOrderIds();
  });

  it('keeps the job prompt when the pending read fails, and logs only the error name', async () => {
    failPending = true;
    jobs.set(JOB_A, running(JOB_A, 'needs_shopper', { label: AGENT_LABEL, fieldRef: 'qty' }));
    const res = await poll(ORDER_A);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.prompt.label, AGENT_LABEL);
    assert.equal(body.prompt.fieldRef, 'qty');
    const text = logs.join('\n');
    assert.match(text, /QueryFailed/);
    assert.equal(text.includes(ADMIN_LABEL), false);
    assert.equal(text.includes(AGENT_LABEL), false);
    assertOrderIds();
  });

  it('omits the prompt once the order is quoted, settled, or refunded', async () => {
    await seed(ORDER_A, ADMIN_LABEL, 'admin', 'admin');
    await store.set(record({ jobId: undefined }));
    const quoted = await (await poll(ORDER_A)).json();
    assert.equal(quoted.stage, 'quoted');
    assert.equal(quoted.prompt, undefined);

    await store.set(record({ outcome: 'settled' }));
    const done = await (await poll(ORDER_A)).json();
    assert.equal(done.stage, 'done');
    assert.equal(done.prompt, undefined);

    await store.set(record({ outcome: 'refunded' }));
    const refunded = await (await poll(ORDER_A)).json();
    assert.equal(refunded.stage, 'refunded');
    assert.equal(refunded.prompt, undefined);
  });
});
