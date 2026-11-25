/**
 * Whether this cookie may see Pagar on the current Coto cart.
 * Guests get { allowed: false }, not a 401. The allowlist is never returned.
 */
import { admitCotoRequest } from '../../../../lib/checkout/coto-admit.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ allowed: false });
  const allowed = await admitCotoRequest(user.address);
  return Response.json({ allowed });
}
