/**
 * Coto is a catalog, not a checkout.
 * A retailer of `coto` on a client cart must not open a quote, a job, or an escrow.
 * A record this server stored for the dual mock is the one exception, and only
 * because the quote already checked the flag, `mock`, and that it is not a
 * manual fee. Start, open, and channels trust that record. They do not read
 * the config cache again.
 * No imports: the checkout tests load this file by stripping types.
 */

export function cotoCheckoutBlocked(retailer: string | null | undefined): boolean {
  return retailer === 'coto';
}

/** The quote stored a Coto mock that is not a manual fee and not a real Coto checkout. */
export function cotoDemoPayRecord(
  rec: { retailer?: string | null; mode?: string | null; checkoutKind?: string | null } | null | undefined,
): boolean {
  return Boolean(
    rec &&
      rec.retailer === 'coto' &&
      rec.mode === 'mock' &&
      rec.checkoutKind !== 'manual_fee_v1' &&
      rec.checkoutKind !== 'coto_real_v1',
  );
}

/** A real Coto checkout. Start, open, and channels let an admitted one through and refuse one that is not admitted. */
export function cotoRealRecord(
  rec: { checkoutKind?: string | null } | null | undefined,
): boolean {
  return rec?.checkoutKind === 'coto_real_v1';
}

/**
 * Receipt basis when a job settles.
 * A placed Coto mock is simulated. A real Coto record is not that simulation.
 * A Día mock that placed stays a store order.
 * Plain `demo` stopped at payment on purpose.
 */
export function settleBasis(
  rec: {
    retailer?: string | null;
    mode?: string | null;
    checkoutKind?: string | null;
    storeOrderId?: string | null;
  } | null | undefined,
): string {
  if (rec?.checkoutKind === 'coto_real_v1') {
    return rec.storeOrderId && rec.storeOrderId.trim() ? 'basis|coto-real-placed' : 'basis|coto-real-not-placed';
  }
  if (rec?.retailer === 'coto' && rec.mode === 'mock') return 'basis|demo-coto-simulated';
  if (rec?.mode === 'demo') return 'basis|demo-reached-payment';
  return 'basis|sandbox-order-placed';
}
