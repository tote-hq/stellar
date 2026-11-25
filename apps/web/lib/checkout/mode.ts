/**
 * Which checkout run a basket gets.
 *
 * `mock` is the operator's in-process sandbox. `live` is an admitted manual
 * checkout: the shopper pays Día with their own card in the viewer. Everything
 * else is `demo`, which stops at the payment step and refunds.
 */
export type CheckoutMode = 'live' | 'demo' | 'mock';

export function checkoutMode(input: { mock: boolean; manual: boolean }): CheckoutMode {
  if (input.mock) return 'mock';
  if (input.manual) return 'live';
  return 'demo';
}
