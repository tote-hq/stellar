/**
 * Starts the Railway Coto job after the shopper locked testnet USDC.
 * No Día login, no card, no demo job.
 */
import { readOrder } from './escrow-server.ts';
import { cotoShopperBody } from './coto-real.ts';
import { startCotoRealJob } from './sandbox.ts';
import { checkoutStore, type CheckoutRecord } from './store.ts';

export async function startCotoRealCheckout(rec: CheckoutRecord, openSig: string | undefined): Promise<Response> {
  if (!rec.resolvedAddress) {
    return Response.json({ error: 'No tenemos cobertura para ese CP' }, { status: 400 });
  }
  if (!rec.jobId) {
    let order = await readOrder(rec.orderId);
    for (let i = 0; !order && i < 4; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      order = await readOrder(rec.orderId);
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
      rec.jobId = await startCotoRealJob(rec.orderId, items, rec.resolvedAddress);
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
