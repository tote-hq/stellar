/**
 * GET /api/compare/probe
 *
 * Runs the fixed Día basket against the Coto catalog and returns match rate
 * and latency. No rows, no prices, no Constructor URL. 404 unless
 * `COMPARE_PROBE_TOKEN` is set and the bearer matches, so an unset token
 * does not advertise the route.
 */
import { compareDiaToCoto, PROBE_BASKET, PROBE_POSTAL } from '@changuito/mcp/compare';

import { probeAuthorized } from '../../../../lib/compare-probe.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

function errorFields(err: unknown): { name: string; code: string; message: string } {
  const name = err instanceof Error ? err.name : 'error';
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return { name, code, message };
}

export async function GET(req: Request): Promise<Response> {
  const token = process.env.COMPARE_PROBE_TOKEN?.trim() || undefined;
  if (!probeAuthorized(req.headers.get('authorization'), token)) return notFound();

  const started = Date.now();
  try {
    const { stats } = await compareDiaToCoto(PROBE_BASKET, PROBE_POSTAL);
    console.log('[compare-probe]', JSON.stringify({ ok: true, ...stats }));
    return Response.json({ ok: true, stats }, { headers: NO_STORE });
  } catch (err) {
    const fields = errorFields(err);
    const body = { ok: false, durationMs: Date.now() - started, ...fields };
    console.log('[compare-probe]', JSON.stringify(body));
    return Response.json(body, { status: 503, headers: NO_STORE });
  }
}
