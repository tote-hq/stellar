/**
 * POST /api/faucet { address, proof, chunks? }  ->  { xlm, usdc, usdcDisplay, txHash, created }
 *
 * Two steps, in this order, and the order is the point:
 *
 *   1. friendbot, if the address has no account yet.
 *   2. mint demo USDC in +100 USDC chunks, capped at 1000 USDC balance.
 *
 * Body `{ chunks?: 1..10 }` defaults to 1. Outside that range → 400 (from the gate).
 * Cap and cooldown both answer 429 with distinct notes (`reasonKind`).
 *
 * GET /api/faucet?address=…&network=…  ->  { mode, allowed }
 */
import { faucetOnNetwork } from '../../../lib/faucet-auth.ts';
import { faucetButton, gateFaucet } from '../../../lib/faucet-gate.ts';
import { CAP_UNITS, faucetVerdict } from '../../../lib/faucet-policy.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { networkNotServed, requestNetwork } from '../../../lib/server-network.ts';
import { usdcAsAdmin } from '../../../lib/server/resolver.ts';
import { ensureFunded, formatUsdc } from '../../../lib/stellar.ts';
import { usdcBalance } from '../../../lib/token.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface FaucetResponse {
  address: string;
  /** XLM after funding, or null for a smart wallet. */
  xlm: string | null;
  /** True when friendbot created the account on this call. */
  created: boolean;
  usdc: string;
  usdcDisplay: string;
  /** The mint transaction, or null when the wallet already had enough. */
  txHash: string | null;
}

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const params = new URL(req.url).searchParams;
  const address = params.get('address') ?? '';
  const asked = requestNetwork(params.get('network'));
  if (!asked.ok) return networkNotServed();
  const network = asked.network;
  const access = await faucetButton(address, process.env, network);
  return Response.json(access, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request): Promise<Response> {
  // Before friendbot and before the mint: both are signed by us.
  const gate = await gateFaucet(req);
  if (gate instanceof Response) return gate;
  const { address, kind, network, chunks } = gate;

  try {
    // 1. XLM first. A contract wallet has no Horizon account to fund.
    let xlm: string | null = null;
    let created = false;
    if (kind === 'account') {
      const funding = await ensureFunded(address, network);
      xlm = funding.xlm;
      created = funding.created;
    }

    // Faucet only exists on networks with friendbot / demo mint.
    if (!faucetOnNetwork(network)) {
      return Response.json({ error: 'El faucet no está disponible en esta red.' }, { status: 403 });
    }

    const before = await usdcBalance(address, network);
    const verdict = faucetVerdict({
      balanceUnits: before,
      now: Date.now(),
      chunks,
    });

    if (!verdict.allow) {
      const body: FaucetResponse & { note: string; reasonKind: string } = {
        address,
        xlm,
        created,
        usdc: before.toString(),
        usdcDisplay: formatUsdc(before),
        txHash: null,
        note: verdict.reason,
        reasonKind: verdict.reasonKind,
      };
      return Response.json(body, { status: created ? 200 : 429 });
    }

    const tx = await usdcAsAdmin(network).mint({ to: address, amount: verdict.amount });
    const sent = await tx.signAndSend();

    const after = before + verdict.amount;
    const capped = after > CAP_UNITS ? CAP_UNITS : after;
    const body: FaucetResponse = {
      address,
      xlm,
      created,
      usdc: capped.toString(),
      usdcDisplay: formatUsdc(capped),
      txHash: sent.sendTransactionResponse?.hash ?? null,
    };
    return Response.json(body);
  } catch (err) {
    console.error('[faucet] failed:', err);
    return Response.json({ error: 'No pudimos cargar USDC de prueba. Probá de nuevo en un momento.' }, { status: 502 });
  }
}
