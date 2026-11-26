import { isAdmin, requireAdmin } from '../../../../../../lib/admin/guard.ts';
import { readCotoViewer } from '../../../../../../lib/checkout/sandbox.ts';
import { checkoutStore } from '../../../../../../lib/checkout/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The URL is fetched live and not written to the notification or the order. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  const { id } = await ctx.params;
  const rec = await checkoutStore().get(id);
  if (!rec?.jobId || rec.jobId === 'none') {
    return Response.json({ url: null }, { headers: { 'cache-control': 'private, no-store' } });
  }
  const url = await readCotoViewer(rec.jobId);
  return Response.json({ url }, { headers: { 'cache-control': 'private, no-store' } });
}
