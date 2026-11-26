import { addCardToCart, parseCartAddBody } from '@/lib/cart-add';
import { chatDualCompareEnabled, getRetailerSearch } from '@/lib/config';
import { requireHuman } from '@/lib/human-gate';
import { readLoggedInUser } from '@/lib/login-gate';
import { callMcpTool } from '@/lib/mcp/bridge';
import { withSession } from '@/lib/mcp/session';
import { networkNotServed, requestNetwork } from '@/lib/server-network';
import { turnStore } from '@/lib/agent/turn-store';

/**
 * One card click. Not a model turn: the shopper named the product and the
 * chain, and the server prices the line. History is written only after the
 * add returns cleanly.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const turns = turnStore();

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }
  const parsed = parseCartAddBody(raw);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);

  const asked = requestNetwork(parsed.body.network, undefined, undefined, 'default');
  if (!asked.ok) return networkNotServed();

  const user = await readLoggedInUser(req);
  const owner = user.ok ? user.address : null;

  try {
    const compareOn = await chatDualCompareEnabled();
    const retailers = await getRetailerSearch();
    const { result, snapshot } = await withSession(parsed.body.sessionId, parsed.body.snapshot, async (session) => {
      const turn = await turns.get(parsed.body.sessionId);
      if (!turn) return { ok: false as const, status: 409, error: 'no_turn' };
      const outcome = await addCardToCart({
        session,
        cache: turn.cache,
        chain: parsed.body.chain,
        id: parsed.body.id,
        owner,
        compareOn,
        cotoEnabled: retailers.enabled.coto === true,
        call: async (name, input) => {
          const reply = await callMcpTool(session.client, { id: `card-${name}`, name, input });
          return { isError: reply.block.is_error === true, structured: reply.structured };
        },
      });
      if (outcome.ok) await turns.set(parsed.body.sessionId, turn);
      return outcome;
    });
    if (!result.ok) return json({ ok: false, error: result.error, snapshot }, result.status);
    return json({ ok: true, event: result.event, snapshot }, 200);
  } catch {
    return json({ ok: false, error: 'add_failed' }, 503);
  }
}
