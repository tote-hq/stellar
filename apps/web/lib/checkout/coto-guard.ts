/**
 * Coto is a catalog, not a checkout.
 * A retailer of `coto` must not open a quote, a job, or an escrow.
 * No imports: the checkout tests load this file by stripping types.
 */

export function cotoCheckoutBlocked(retailer: string | null | undefined): boolean {
  return retailer === 'coto';
}
