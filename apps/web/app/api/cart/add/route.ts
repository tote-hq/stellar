import { cotoPricer } from '@changuito/mcp/compare';

import { newTurnState } from '@/lib/agent/loop';
import { addCardToCart, parseCartAddBody } from '@/lib/cart-add';
import { admitCotoRequest } from '@/lib/checkout/coto-admit';
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
      const stored = await turns.get(parsed.body.sessionId);
      const turn = stored ?? newTurnState();
      turn.cache.cotoPay = owner ? await admitCotoRequest(owner) : false;
      const outcome = await addCardToCart({
        session,
        cache: turn.cache,
        chain: parsed.body.chain,
        id: parsed.body.id,
        owner,
        compareOn,
        cotoEnabled: retailers.enabled.coto === true,
        freshTurn: !stored,
        catalog:
          parsed.body.chain === 'coto'
            ? {
                async getProduct(id: string) {
                  const item = await cotoPricer().getProduct(id);
                  if (!item || !Number.isSafeInteger(item.shelfPrice.centavos) || item.shelfPrice.centavos <= 0) {
                    return null;
                  }
                  return {
                    id: item.id,
                    name: item.name,
                    shelfCentavos: item.shelfPrice.centavos,
                    available: item.available,
                    ...(item.ean ? { ean: item.ean } : {}),
                    ...(item.brand ? { brand: item.brand } : {}),
                    ...(item.url ? { url: item.url } : {}),
                    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
                  };
                },
              }
            : undefined,
        call: async (name, input) => {
          const reply = await callMcpTool(session.client, { id: `card-${name}`, name, input });
          const message = typeof reply.block.content === 'string' ? reply.block.content : undefined;
          return { isError: reply.block.is_error === true, structured: reply.structured, message };
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
