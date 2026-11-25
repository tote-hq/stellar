import { csrfOk, empty401, isAdmin, requireAdmin } from '../../../../../../lib/admin/guard.ts';
import { adminStore } from '../../../../../../lib/admin/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  if (!csrfOk(req, admin.payload)) return empty401();
  const { id } = await ctx.params;
  let label = '';
  try {
    const body = (await req.json()) as { label?: unknown };
    label = typeof body.label === 'string' ? body.label.trim() : '';
  } catch {
    label = '';
  }
  if (!label) {
    return Response.json({ error: 'Falta la pregunta.' }, { status: 400, headers: { 'cache-control': 'private, no-store' } });
  }
  try {
    const opened = await adminStore().openPrompt({
      orderId: id,
      label,
      fieldRef: 'admin',
      options: null,
      source: 'admin',
    });
    if (opened === 'conflict') {
      return Response.json(
        { error: 'Ya hay una pregunta pendiente.' },
        { status: 409, headers: { 'cache-control': 'private, no-store' } },
      );
    }
  } catch (err) {
    console.error('[admin/prompt]', err instanceof Error ? err.name : 'insert');
    return Response.json({ error: 'No pudimos enviar la pregunta.' }, { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}
