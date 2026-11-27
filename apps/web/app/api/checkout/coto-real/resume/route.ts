/**
 * GET /api/checkout/coto-real/resume
 *
 * The open coto_real_v1 order for this wallet, if one is still shopping.
 * No quote, no lock, no store write, no admission change.
 */
import { openCotoOrder } from '../../../../../lib/checkout/coto-pay-open.ts';
import { checkoutStore } from '../../../../../lib/checkout/store.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NONE = { orderId: null };

export async function GET(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ error: 'Iniciá sesión.' }, { status: 401 });
  try {
    const rows = await checkoutStore().listByBuyer(user.address);
    const open = openCotoOrder(rows, user.address);
    return Response.json(open ?? NONE, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[checkout/coto-real/resume]', err instanceof Error ? err.name : 'query');
    return Response.json(NONE, { headers: { 'cache-control': 'no-store' } });
  }
}
