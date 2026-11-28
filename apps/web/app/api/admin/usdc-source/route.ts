/**
 * GET  → both balance-line flags and when each was written.
 * PUT  { key, value } → one row. The other key is not written.
 *
 * No admin cookie is 401. A missing or wrong CSRF token on PUT is 403.
 * A key other than the two, or a value other than mock or circle, is 400
 * and nothing is written. The body never carries an address, an issuer or
 * a contract id.
 */
import { csrfOk, empty401, isAdmin, requireAdmin } from '../../../../lib/admin/guard.ts';
import {
  isUsdcSourceKey,
  isUsdcSourceValue,
  readUsdcSources,
  writeUsdcSource,
} from '../../../../lib/admin/usdc-source.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

export async function GET(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  try {
    const rows = await readUsdcSources();
    return Response.json(rows, { headers: NO_STORE });
  } catch (err) {
    console.error('[admin/usdc-source] read', err instanceof Error ? err.name : 'query');
    return Response.json({ error: 'read_failed' }, { status: 503, headers: NO_STORE });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (!isAdmin(admin)) return admin;
  if (!csrfOk(req, admin.payload)) {
    return Response.json({ error: 'csrf' }, { status: 403, headers: NO_STORE });
  }
  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!isUsdcSourceKey(body?.key) || !isUsdcSourceValue(body?.value)) {
    return Response.json({ error: 'invalid' }, { status: 400, headers: NO_STORE });
  }
  try {
    const row = await writeUsdcSource(body.key, body.value);
    if (!row) return Response.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
    return Response.json({ key: body.key, value: row.value, updatedAt: row.updatedAt }, { headers: NO_STORE });
  } catch (err) {
    console.error('[admin/usdc-source] write', err instanceof Error ? err.name : 'query');
    return Response.json({ error: 'write_failed' }, { status: 503, headers: NO_STORE });
  }
}
