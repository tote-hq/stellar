import { createHash, timingSafeEqual } from 'node:crypto';
import { db, hasDatabase } from '../db.ts';
import { DEFAULT_NETWORK } from '../deployments.ts';
import { checkoutStore, type CheckoutRecord } from './store.ts';
import { readOrder, settleOrder, refundOrder } from './escrow-server.ts';
import { feeVerdict, type ManualEvent, SERVICE_FEE_UNITS } from './manual-policy.ts';
import type { StatusResponse } from './types.ts';

/**
 * Whether this wallet may open a manual checkout.
 *
 * The allowlist is `shared_card_member` for the default network. The table
 * name is historical: this read never touches `shared_card` and never sees a
 * PAN, an expiry or a CVV. No database, or a query that fails, is not a member.
 */
export async function manualMember(buyer: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!hasDatabase(env)) return false;
  try {
    const rows = await db(env)`
      select 1 from shared_card_member
       where network = ${DEFAULT_NETWORK} and address = ${buyer}`;
    return rows.length > 0;
  } catch (err) {
    console.error(
      '[checkout/manual] member list unreadable; treating as not a member:',
      err instanceof Error ? err.name : err,
    );
    return false;
  }
}

export function workerAuthorized(header: string | null, token = process.env.SANDBOX_TOKEN): boolean {
  if (!token || !header) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

export async function sandboxRequest(path: string, body?: unknown): Promise<Response> {
  if (!process.env.SANDBOX_URL || !process.env.SANDBOX_TOKEN) throw new Error('sandbox unavailable');
  return fetch(`${process.env.SANDBOX_URL.replace(/\/$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${process.env.SANDBOX_TOKEN}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function manualAvailable(): Promise<boolean> {
  try {
    const res = await sandboxRequest('/health');
    return res.ok && (await res.json()).manual_ready === true;
  } catch { return false; }
}

/** Only the worker can advance service readiness; a browser cannot claim it. */
export async function recordManualEvent(e: ManualEvent): Promise<CheckoutRecord | undefined> {
  const state = { preparation: e.preparation, purchase: e.purchase, preparedAt: e.preparedAt,
    viewerExpiresAt: e.viewerExpiresAt, sessionActive: e.sessionActive, sequence: e.sequence };
  await db()`update manual_checkout set
    record = record || ${db().json({ manual: state, jobId: e.job_id, phase: e.phase,
      storeOrderId: e.store_order_id ?? undefined } as never)},
    event_seq=${e.sequence}, updated_at=now()
    where order_id=${e.order_id} and event_seq < ${e.sequence}
      and (record->>'jobId' is null or record->>'jobId'=${e.job_id})
      and ((record->'manual'->>'preparedAt') is null
        or (record->'manual'->>'preparedAt')::bigint=${e.preparedAt})`;
  return checkoutStore().get(e.order_id);
}

async function performManualResolution(rec: CheckoutRecord): Promise<boolean> {
  if (!rec.manual || rec.checkoutKind !== 'manual_fee_v1') throw new Error('not a manual order');
  const verdict = feeVerdict(rec.manual);
  if (!verdict) return true;
  const order = await readOrder(rec.orderId);
  if (!order || order.buyer !== rec.buyer || order.amount !== BigInt(SERVICE_FEE_UNITS) || order.basketHash !== rec.basketHash) {
    throw new Error('fee account mismatch');
  }
  if (order.status === 'open') {
    if (verdict === 'settle') {
      const receipt = `changuito/receipt/service-v1\norder|${rec.orderId}\nbasket|${rec.basketHash}\nbasis|checkout-prepared/v1\njob|${rec.jobId}\nprepared|${rec.manual.preparedAt}\nexpires|${rec.manual.viewerExpiresAt}\n`;
      rec.closeSig = await settleOrder(order, createHash('sha256').update(receipt).digest());
      rec.outcome = 'settled';
    } else {
      rec.closeSig = await refundOrder(order);
      rec.outcome = 'refunded';
    }
  } else rec.outcome = order.status === 'settled' ? 'settled' : 'refunded';
  rec.closeFailures = 0;
  await checkoutStore().set(rec);
  return true;
}

/** Retryable failure status is durable; the worker's outbox drives retries after the tab closes. */
export async function resolveManualFee(rec: CheckoutRecord): Promise<boolean> {
  try {
    return await performManualResolution(rec);
  } catch {
    rec.closeFailures = (rec.closeFailures ?? 0) + 1;
    await checkoutStore().set(rec);
    console.warn('[checkout/manual]', { order: rec.orderId.slice(0, 8), code: 'fee_resolution_pending' });
    throw new Error('fee resolution pending');
  }
}

export function manualStatus(rec: CheckoutRecord): StatusResponse {
  const m = rec.manual!;
  const verdict = feeVerdict(m);
  return {
    checkoutKind: 'manual_fee_v1', manual: m,
    feeStatus: rec.outcome ?? (verdict === 'settle' ? 'settlement_pending' : verdict === 'refund' ? 'refund_pending' : 'escrowed'),
    orderId: rec.orderId, stage: rec.outcome === 'refunded' ? 'refunded' : m.purchase === 'placed' ? 'done' : 'shopping',
    phase: rec.phase ?? 'queued', payment: m.purchase === 'placed' ? 'placed' : m.purchase === 'declined' ? 'declined' : null,
    storeOrderId: rec.storeOrderId ?? null, openSig: rec.openSig ?? null, closeSig: rec.closeSig ?? null,
    handoffUrl: null, amountDisplay: '0.10', error: null, mode: 'live', alert: rec.closeFailures ? 'resolver_failed' : null,
    ...(rec.manualFlow ? { manualFlow: rec.manualFlow } : {}),
  };
}
