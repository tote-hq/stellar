/**
 * The rail and the model read one basket.
 *
 * A turn that lands on another isolate has an empty cache while the session
 * snapshot still has the Coto lines or the Día cart id. The banner would say
 * `cart empty` and the model would believe it. This reads `view_cart` before
 * hop 0, writes the result into the cache, and seals the fingerprint so the
 * automatic card does not redraw a basket the shopper is already looking at.
 * It emits no trail row.
 */
import { rememberStructured, sealCartDraw, type RenderCache } from './render-tools.ts';

export type CartSync = 'ready' | 'unknown' | 'skip';

export async function syncRailCart(args: {
  cache: RenderCache;
  cotoLines: number;
  diaCartId: string | undefined;
  viewCart: () => Promise<{ ok: boolean; structured?: unknown }>;
}): Promise<CartSync> {
  const already = args.cache.cart;
  if (already) return 'skip';
  if (args.cotoLines <= 0 && !args.diaCartId) return 'skip';
  try {
    const result = await args.viewCart();
    if (!result.ok) {
      console.warn('coto-pay cart-sync');
      return 'unknown';
    }
    rememberStructured(args.cache, result.structured);
    if (!args.cache.cart || args.cache.cart.lines.length === 0) {
      console.warn('coto-pay cart-sync');
      return 'unknown';
    }
    sealCartDraw(args.cache);
    return 'ready';
  } catch (err) {
    console.warn('coto-pay cart-sync', err instanceof Error ? err.name : 'error');
    return 'unknown';
  }
}
