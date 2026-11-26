/**
 * Starts the Railway Coto job after the shopper locked testnet USDC.
 * No Día login, no card, no demo job. Payment uses the card saved on the Coto account.
 */
import { readOrder } from './escrow-server.ts';
import { MISSING_CITY_COPY, cotoShopperBody } from './coto-real.ts';
import { startCotoRealJob, type CotoRealDelivery, type SandboxItem } from './sandbox.ts';
import { checkoutStore, type CheckoutRecord } from './store.ts';

type EscrowOrder = { buyer: string; status: string; amount: bigint; basketHash: string };
type EscrowRead = (orderId: string) => Promise<EscrowOrder | null>;
type JobStart = (
  orderId: string,
  items: SandboxItem[],
  input: { fulfillment: 'home' | 'pickup'; city: string; delivery?: CotoRealDelivery },
) => Promise<string>;

let readEscrow: EscrowRead = (orderId) => readOrder(orderId);
let startReal: JobStart = (orderId, items, input) => startCotoRealJob(orderId, items, input);

/** Tests stub the chain read and the sandbox start. Null restores both. */
export function __setCotoRealStartForTests(
  next: { readOrder?: EscrowRead | null; starter?: JobStart | null } | null,
): void {
  readEscrow = next?.readOrder ?? ((orderId) => readOrder(orderId));
  startReal = next?.starter ?? ((orderId, items, input) => startCotoRealJob(orderId, items, input));
}

export async function startCotoRealCheckout(rec: CheckoutRecord, openSig: string | undefined): Promise<Response> {
  if (rec.fulfillment !== 'pickup' && !rec.resolvedAddress) {
    return Response.json({ error: 'Falta la dirección de esta compra.' }, { status: 400 });
  }
  const city = rec.city?.trim() || rec.resolvedAddress?.city?.trim() || '';
  if (!city) return Response.json({ error: MISSING_CITY_COPY }, { status: 400 });
  if (!rec.jobId) {
    let order = await readEscrow(rec.orderId);
    for (let i = 0; !order && i < 4; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      order = await readEscrow(rec.orderId);
    }
    if (!order) return Response.json({ error: 'Todavía no vemos el pago en la red.' }, { status: 409 });
    if (order.buyer !== rec.buyer) return Response.json({ error: 'El pago no es de esta billetera.' }, { status: 403 });
    if (order.status !== 'open') return Response.json({ error: 'Ese pedido ya está cerrado.' }, { status: 409 });
    if (order.amount < BigInt(rec.amount)) return Response.json({ error: 'El monto bloqueado no alcanza.' }, { status: 409 });
    if (order.basketHash !== rec.basketHash) {
      return Response.json({ error: 'El changuito bloqueado no es el cotizado.' }, { status: 409 });
    }
    rec.openSig = openSig ?? rec.openSig;
    rec.mode = 'live';
    const items = rec.lines.map((line) => ({ name: line.name, quantity: line.quantity, sku: line.skuId }));
    try {
      rec.jobId = await startReal(rec.orderId, items, {
        fulfillment: rec.fulfillment ?? 'home',
        city,
        ...(rec.resolvedAddress ? { delivery: rec.resolvedAddress } : {}),
      });
    } catch (err) {
      console.error('[checkout/start] coto', err instanceof Error ? err.message : 'start failed');
      rec.error = 'No pudimos arrancar la compra.';
      rec.jobId = 'none';
    }
    rec.phase = 'queued';
    rec.startedAt = Date.now();
    await checkoutStore().set(rec);
  }
  return Response.json(cotoShopperBody(rec, 'shopping', null), { headers: { 'cache-control': 'no-store' } });
}
