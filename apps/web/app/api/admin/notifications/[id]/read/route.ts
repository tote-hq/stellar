import { csrfOk, empty401, isAdmin, requireAdmin } from '../../../../../../lib/admin/guard.ts';
import { adminStore } from '../../../../../../lib/admin/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  if (!csrfOk(req, admin.payload)) return empty401();
  const { id } = await ctx.params;
  try {
    await adminStore().markRead(id);
  } catch (err) {
    console.error('[admin/read]', err instanceof Error ? err.name : 'update');
    return new Response(null, { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}
