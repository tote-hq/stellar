import { isAdmin, requireAdmin } from '../../../../lib/admin/guard.ts';
import { withBuyers } from '../../../../lib/admin/notes.ts';
import { adminStore } from '../../../../lib/admin/store.ts';
import { checkoutStore } from '../../../../lib/checkout/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  try {
    const notes = await withBuyers(await adminStore().notifications(), (id) => checkoutStore().get(id));
    return Response.json({ notifications: notes }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (err) {
    console.error('[admin/notifications]', err instanceof Error ? err.name : 'query');
    return Response.json({ notifications: [] }, { headers: { 'cache-control': 'private, no-store' } });
  }
}
