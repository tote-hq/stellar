import { adminStore } from '../../../../lib/admin/store.ts';
import { postCotoShopperAnswer } from '../../../../lib/checkout/sandbox.ts';
import { checkoutStore } from '../../../../lib/checkout/store.ts';
import { readSessionUser, sessionMismatchResponse } from '../../../../lib/session-match.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const user = await readSessionUser(req);
  if (!user.ok) return sessionMismatchResponse(req);
  let orderId = '';
  let answer = '';
  try {
    const body = (await req.json()) as { orderId?: unknown; answer?: unknown };
    orderId = typeof body.orderId === 'string' ? body.orderId : '';
    answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  } catch {
    orderId = '';
  }
  if (!orderId || !answer) {
    return Response.json({ error: 'Falta la respuesta.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const rec = await checkoutStore().get(orderId);
  if (!rec || rec.buyer !== user.address) {
    return Response.json({ error: 'Ese pedido no es de esta billetera.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  let pending;
  try {
    pending = await adminStore().pendingPrompt(orderId);
  } catch (err) {
    console.error('[checkout/prompt]', err instanceof Error ? err.name : 'query');
    return Response.json({ error: 'No pudimos guardar la respuesta.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (!pending) {
    return Response.json({ error: 'No hay una pregunta pendiente.' }, { status: 409, headers: { 'cache-control': 'no-store' } });
  }
  const sent = rec.jobId && rec.jobId !== 'none'
    ? await postCotoShopperAnswer(rec.jobId, pending.fieldRef ?? 'admin', answer)
    : true;
  if (!sent) {
    return Response.json({ error: 'No pudimos guardar la respuesta.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  try {
    await adminStore().answerPrompt(orderId, answer);
  } catch (err) {
    console.error('[checkout/prompt]', err instanceof Error ? err.name : 'update');
    return Response.json({ error: 'No pudimos guardar la respuesta.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
