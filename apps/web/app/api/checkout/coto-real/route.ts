/**
 * Whether this cookie may see Pagar on the current Coto cart.
 * Guests get { allowed: false }, not a 401. The allowlist is never returned.
 */
import { admitCotoReal, parseAllowlist } from '../../../../lib/checkout/coto-real.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok && user.mismatch) return sessionMismatchResponse(req);
  if (!user.ok) return Response.json({ allowed: false });
  const allowed = admitCotoReal({
    address: user.address,
    enabled: process.env.COTO_REAL_ENABLED === '1',
    allowlist: parseAllowlist(process.env.COTO_REAL_ALLOWLIST),
  });
  return Response.json({ allowed });
}
