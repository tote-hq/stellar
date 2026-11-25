import { isAdmin, requireAdmin } from '../../../../lib/admin/guard.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  return Response.json({ csrf: admin.payload.csrf }, { headers: { 'cache-control': 'private, no-store' } });
}
